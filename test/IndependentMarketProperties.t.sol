// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {IndependentOutcomeMarket, IIndependentCollateral} from "../src/IndependentOutcomeMarket.sol";
import {IndependentUnitSource} from "./IndependentOutcomeMarket.t.sol";
import {MockCst} from "./utils/Mocks.sol";

/// @notice Integrated cash-flow properties with expectations derived from inputs,
/// not copied from the market's claim or funding preview implementations.
contract IndependentMarketPropertiesTest is Test {
    IndependentOutcomeMarket private market;
    IndependentUnitSource private source;
    MockCst private token;
    address private constant ALICE = address(201);
    address private constant BOB = address(202);
    address private constant CAROL = address(203);
    uint256 private constant SEED = 8000e18;
    uint256 private constant MIN_FUND = 8e12;
    uint256 private constant MAX_C = 1 << 120;

    struct Book {
        uint256[8] yes;
        uint256[8] no;
        uint256[8] transferred;
        uint256 spent;
    }

    function setUp() public {
        vm.warp(100);
        token = new MockCst();
        source = new IndependentUnitSource();
        source.set(0, false, true, 255, 0, 0, 100);
        source.set(1, true, false, 0, 0, 100, 0);
        market = new IndependentOutcomeMarket(IIndependentCollateral(address(token)), source);
        address[4] memory people = [address(this), ALICE, BOB, CAROL];
        for (uint256 i; i < people.length; ++i) {
            token.mint(people[i], 1e45);
            vm.prank(people[i]);
            token.approve(address(market), type(uint256).max);
        }
    }

    function testFuzz_fundingAndFurtherGiftAllocateExactlyWithoutMintingClaims(uint256 rawFund, uint256 rawGift)
        public
    {
        uint256 first = bound(rawFund, MIN_FUND, 1e27);
        uint256 gift = bound(rawGift, 1, 1e25);
        uint256 beforeAlice = token.balanceOf(ALICE);
        uint256 beforeBob = token.balanceOf(BOB);
        vm.prank(ALICE);
        market.fundRound(1, first);
        vm.prank(BOB);
        market.fundRound(1, gift);
        assertEq(beforeAlice - token.balanceOf(ALICE), first);
        assertEq(beforeBob - token.balanceOf(BOB), gift);
        uint256 total;
        for (uint8 q; q < 8; ++q) {
            uint256 expected = first / 8 + (q < first % 8 ? 1 : 0) + gift / 8 + (q < gift % 8 ? 1 : 0);
            IndependentOutcomeMarket.QuestionView memory state = market.questionState(1, q);
            assertEq(state.activeCollateral, expected);
            assertEq(state.yesSupply, 0);
            assertEq(state.noSupply, 0);
            assertEq(market.balanceOf(ALICE, market.positionId(1, q, true)), 0);
            assertEq(market.balanceOf(BOB, market.positionId(1, q, false)), 0);
            total += expected;
        }
        assertEq(total, first + gift);
        assertEq(market.totalActiveCollateral(), total);
        assertEq(token.balanceOf(address(market)), total);
        assertEq(market.pendingCarry(), 0);
    }

    function testFuzz_asymmetricClaimsStayBackedAfterRolloverAndOfflineFarFuture(
        uint128[16] memory rawCash,
        uint8 finalValues,
        uint256 futureTimestamp
    ) public {
        market.fundRound(1, SEED);
        Book memory book = _positions(rawCash);
        _close(finalValues);
        (uint256 owed, uint256 alicePay, uint256 bobPay, uint256 carolPay) = _expected(book, finalValues);
        uint256 expectedCarry = SEED + book.spent - owed;
        (uint256 actualOwed, uint256 actualCarry) = market.settleRound(1);
        assertEq(actualOwed, owed);
        assertEq(actualCarry, expectedCarry);
        for (uint8 q; q < 8; ++q) {
            uint256 expected = (finalValues & (uint8(1) << q)) != 0 ? book.yes[q] : book.no[q];
            assertEq(market.settlementVault().remaining(1, q), expected);
        }
        source.setOffline(1, true);
        source.set(2, true, false, 0, 0, 200, 0);
        market.fundRound(2, 0);
        assertEq(market.totalActiveCollateral(), expectedCarry);
        assertEq(market.pendingCarry(), 0);
        // Cached winner claims must work even beyond the history timestamp range.
        vm.warp(futureTimestamp < 200 ? 200 : futureTimestamp);
        uint256 aliceBefore = token.balanceOf(ALICE);
        uint256 bobBefore = token.balanceOf(BOB);
        uint256 carolBefore = token.balanceOf(CAROL);
        if ((finalValues & 1) == 0) {
            _claim(CAROL, carolPay);
            _claim(ALICE, alicePay);
            _claim(BOB, bobPay);
        } else {
            _claim(BOB, bobPay);
            _claim(ALICE, alicePay);
            _claim(CAROL, carolPay);
        }
        assertEq(token.balanceOf(ALICE) - aliceBefore, alicePay);
        assertEq(token.balanceOf(BOB) - bobBefore, bobPay);
        assertEq(token.balanceOf(CAROL) - carolBefore, carolPay);
        assertEq(market.settlementVault().totalEscrowed(), 0);
        assertEq(token.balanceOf(address(market.settlementVault())), 0);
        assertEq(market.totalActiveCollateral(), expectedCarry);
        assertEq(token.balanceOf(address(market)), expectedCarry);
        _claim(ALICE, 0);
        _claim(BOB, 0);
        _claim(CAROL, 0);
        _assertNoSupply(1);
    }

    function testFuzz_mergeBeforeAndAfterSettlementHaveIdenticalPayoutsAndCarry(
        uint128[8] memory rawPairs,
        uint8 finalValues,
        uint8 fractionSeed
    ) public {
        market.fundRound(1, SEED);
        vm.prank(BOB);
        market.buy(1, 3, true, 10e18, 15e18, type(uint256).max);
        uint256[8] memory amounts;
        uint256 totalPairs;
        uint256 totalMerge;
        for (uint8 q; q < 8; ++q) {
            uint256 pairs = uint256(rawPairs[q]) % 1e24;
            if (pairs != 0) {
                vm.prank(ALICE);
                market.splitPosition(1, q, pairs);
            }
            totalPairs += pairs;
            amounts[q] = pairs / (1 + uint256(fractionSeed) % 7);
            totalMerge += amounts[q];
        }
        _close(finalValues);
        uint256 bobPay = (finalValues & 8) != 0 ? 15e18 : 0;
        uint256 expectedCarry = SEED + 10e18 - bobPay;
        uint256 aliceBefore = token.balanceOf(ALICE);
        uint256 bobBefore = token.balanceOf(BOB);
        uint256 snap = vm.snapshotState();
        if (totalMerge != 0) {
            vm.prank(ALICE);
            assertEq(market.mergePositions(1, amounts), totalMerge);
        }
        market.settleRound(1);
        _claim(ALICE, totalPairs - totalMerge);
        _claim(BOB, bobPay);
        assertEq(token.balanceOf(ALICE) - aliceBefore, totalPairs);
        assertEq(token.balanceOf(BOB) - bobBefore, bobPay);
        assertEq(market.pendingCarry(), expectedCarry);
        assertTrue(vm.revertToStateAndDelete(snap));
        market.settleRound(1);
        if (totalMerge != 0) {
            vm.prank(ALICE);
            assertEq(market.mergePositions(1, amounts), totalMerge);
        }
        _claim(ALICE, totalPairs - totalMerge);
        _claim(BOB, bobPay);
        assertEq(token.balanceOf(ALICE) - aliceBefore, totalPairs);
        assertEq(token.balanceOf(BOB) - bobBefore, bobPay);
        assertEq(market.pendingCarry(), expectedCarry);
        assertEq(market.settlementVault().totalEscrowed(), 0);
        assertEq(token.balanceOf(address(market)), expectedCarry);
        _assertNoSupply(1);
    }

    function testFuzz_fundingPreviewMatchesCarryPriorityDeferredBalanceAndExecution(
        uint256 rawPriorFunding,
        uint256 rawNewFunding,
        bool settleFirst
    ) public {
        uint256 priorFunding = bound(rawPriorFunding, MIN_FUND, 8 * MAX_C);
        uint256 first = priorFunding < 4 * MAX_C ? priorFunding : 4 * MAX_C;
        market.fundRound(1, first);
        if (priorFunding > first) market.fundRound(1, priorFunding - first);
        _close(0);
        source.set(2, true, false, 0, 0, 200, 0);
        if (settleFirst) market.settleRound(1);
        uint256 carryUsed = priorFunding < 4 * MAX_C ? priorFunding : 4 * MAX_C;
        uint256 maxNew = 4 * MAX_C - carryUsed;
        uint256 newFunding = rawNewFunding % (maxNew + 1);
        uint256 expectedActive = carryUsed + newFunding;
        uint256 expectedDeferred = priorFunding - carryUsed;
        IndependentOutcomeMarket.FundingPreview memory preview = market.fundingPreview(2, newFunding);
        assertTrue(preview.canFund);
        assertEq(preview.needsSettlement, !settleFirst);
        assertEq(preview.availableCarry, priorFunding);
        assertEq(preview.carryUsed, carryUsed);
        assertEq(preview.deferredCarry, expectedDeferred);
        assertEq(preview.maxNewAmount, maxNew);
        assertEq(preview.totalFunding, expectedActive);
        uint256 beforeSponsor = token.balanceOf(address(this));
        market.fundRound(2, newFunding);
        assertEq(beforeSponsor - token.balanceOf(address(this)), newFunding);
        for (uint8 q; q < 8; ++q) {
            uint256 expected = expectedActive / 8 + (q < expectedActive % 8 ? 1 : 0);
            assertEq(preview.allocations[q], expected);
            assertEq(market.questionState(2, q).activeCollateral, expected);
        }
        assertEq(market.pendingCarry(), expectedDeferred);
        assertEq(market.totalActiveCollateral(), expectedActive);
        assertEq(token.balanceOf(address(market)), priorFunding + newFunding);
        assertEq(market.settlementVault().totalEscrowed(), 0);
    }

    function testFuzz_emptyCyclesRollAllCapitalExactlyOnce(uint256 rawFunding, uint8 values) public {
        uint256 funding = bound(rawFunding, MIN_FUND, 4 * MAX_C);
        market.fundRound(1, funding);
        _close(values);
        (uint256 owed, uint256 carried) = market.settleRound(1);
        assertEq(owed, 0);
        assertEq(carried, funding);
        source.setOffline(1, true);
        (owed, carried) = market.settleRound(1);
        assertEq(owed, 0);
        assertEq(carried, 0);
        assertEq(market.pendingCarry(), funding);
        source.set(2, true, false, 0, 0, 200, 0);
        market.fundRound(2, 0);
        (owed, carried) = market.settleRound(1);
        assertEq(owed, 0);
        assertEq(carried, 0);
        assertEq(market.pendingCarry(), 0);
        assertEq(market.totalActiveCollateral(), funding);
        assertEq(token.balanceOf(address(market)), funding);
        assertEq(token.balanceOf(address(market.settlementVault())), 0);
        for (uint8 q; q < 8; ++q) {
            assertEq(market.questionState(2, q).activeCollateral, funding / 8 + (q < funding % 8 ? 1 : 0));
        }
        vm.expectRevert(IndependentOutcomeMarket.InvalidParameters.selector);
        market.fundRound(2, 0);
    }

    function test_all256TerminalVectorsWithAsymmetricAmountsAndThreeHolders() public {
        market.fundRound(1, SEED);
        uint128[16] memory inputs;
        for (uint128 i; i < 16; ++i) {
            inputs[i] = (i + 1) * 1234567891011;
        }
        Book memory book = _positions(inputs);
        for (uint256 value; value < 256; ++value) {
            uint256 snap = vm.snapshotState();
            // The loop bounds the value to0..255.
            // forge-lint: disable-next-line(unsafe-typecast)
            uint8 finalValues = uint8(value);
            _close(finalValues);
            (uint256 owed, uint256 a, uint256 b, uint256 c) = _expected(book, finalValues);
            (uint256 actualOwed, uint256 carry) = market.settleRound(1);
            assertEq(actualOwed, owed);
            assertEq(carry, SEED + book.spent - owed);
            _claim(ALICE, a);
            _claim(BOB, b);
            _claim(CAROL, c);
            assertEq(market.settlementVault().totalEscrowed(), 0);
            assertEq(token.balanceOf(address(market.settlementVault())), 0);
            assertEq(token.balanceOf(address(market)), carry);
            _assertNoSupply(1);
            assertTrue(vm.revertToStateAndDelete(snap));
        }
    }

    function _positions(uint128[16] memory rawCash) private returns (Book memory book) {
        for (uint8 q; q < 8; ++q) {
            uint256 yCash = _cash(rawCash[q]);
            uint256 nCash = _cash(rawCash[q + 8]);
            book.spent += yCash + nCash;
            if (yCash != 0) {
                book.yes[q] = yCash + yCash / 2;
                vm.prank(ALICE);
                market.buy(1, q, true, yCash, book.yes[q], type(uint256).max);
                book.transferred[q] = book.yes[q] / 4;
                uint256 id = market.positionId(1, q, true);
                vm.prank(ALICE);
                market.safeTransferFrom(ALICE, CAROL, id, book.transferred[q], "model transfer");
            }
            if (nCash != 0) {
                book.no[q] = nCash + nCash / 3;
                vm.prank(BOB);
                market.buy(1, q, false, nCash, book.no[q], type(uint256).max);
            }
        }
    }

    function _cash(uint128 raw) private pure returns (uint256) {
        if (raw % 17 == 0) return 0;
        return 1e12 + uint256(raw) % (1e18 - 1e12 + 1);
    }

    function _expected(Book memory book, uint8 values)
        private
        pure
        returns (uint256 total, uint256 alicePay, uint256 bobPay, uint256 carolPay)
    {
        for (uint8 q; q < 8; ++q) {
            if ((values & (uint8(1) << q)) != 0) {
                alicePay += book.yes[q] - book.transferred[q];
                carolPay += book.transferred[q];
            } else {
                bobPay += book.no[q];
            }
        }
        total = alicePay + bobPay + carolPay;
    }

    function _close(uint8 values) private {
        vm.warp(200);
        source.set(1, false, true, 255, values, 100, 200);
    }

    function _claim(address who, uint256 expected) private {
        (bool ready, uint256 preview,) = market.previewClaim(1, who);
        assertTrue(ready);
        assertEq(preview, expected);
        vm.prank(who);
        assertEq(market.claimKnown(1), expected);
    }

    function _assertNoSupply(uint256 round) private view {
        for (uint8 q; q < 8; ++q) {
            assertEq(market.totalSupply(market.positionId(round, q, true)), 0);
            assertEq(market.totalSupply(market.positionId(round, q, false)), 0);
        }
    }
}
