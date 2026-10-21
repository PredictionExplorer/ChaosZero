// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test, Vm} from "forge-std/Test.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {IndependentOutcomeMarket, IIndependentCollateral, MIN_AUTO_TOP_UP} from "../src/IndependentOutcomeMarket.sol";
import {IndependentUnitSource} from "./IndependentOutcomeMarket.t.sol";
import {MockCst} from "./utils/Mocks.sol";

/// @dev Models unsupported external destruction (the real CST game can burn any holder).
contract DestroyableCst is MockCst {
    function destroy(address from, uint256 amount) external {
        balanceOf[from] -= amount;
    }
}

/// @notice Every CST inflow reaches the eight pools through one routine: plain
/// transfers (R1), settled carry at a cycle's start (R2), and top-ups only while
/// a cycle trades (R3). Expectations are derived from inputs, not from the engine.
contract IndependentAutoDistributionTest is Test, ERC1155Holder {
    IndependentOutcomeMarket private market;
    IndependentUnitSource private source;
    DestroyableCst private token;
    address private constant ALICE = address(301);
    address private constant BOB = address(302);
    address private constant DONOR = address(303);
    uint256 private constant SEED = 8000e18;
    uint256 private constant MAX = type(uint256).max;

    event RoundFunded(
        uint256 indexed roundId,
        address indexed caller,
        uint256 donated,
        uint256 transfersUsed,
        uint256 carryUsed,
        uint256[8] allocations
    );

    function setUp() public {
        vm.warp(100);
        token = new DestroyableCst();
        source = new IndependentUnitSource();
        source.set(0, false, true, 255, 0, 0, 100);
        source.set(1, true, false, 0, 0, 100, 0);
        market = new IndependentOutcomeMarket(IIndependentCollateral(address(token)), source);
        address[4] memory people = [address(this), ALICE, BOB, DONOR];
        for (uint256 i; i < people.length; ++i) {
            token.mint(people[i], 1e40);
            vm.prank(people[i]);
            token.approve(address(market), MAX);
        }
    }

    function _share(uint256 total, uint8 q) private pure returns (uint256) {
        return total / 8 + (q < total % 8 ? 1 : 0);
    }

    function _collaterals(uint256 round) private view returns (uint256[8] memory c) {
        for (uint8 q; q < 8; ++q) {
            c[q] = market.questionState(round, q).activeCollateral;
        }
    }

    function _unallocated() private view returns (uint256) {
        return token.balanceOf(address(market)) - market.totalActiveCollateral() - market.pendingCarry();
    }

    function _donate(uint256 amount) private {
        vm.prank(DONOR);
        token.transfer(address(market), amount);
    }

    function _close(uint256 id, uint8 values, uint256 start, uint256 end) private {
        vm.warp(end);
        source.set(id, false, true, 255, values, start, end);
    }

    // R1 + R3: a plain transfer during trading enters every pool before the next trade is priced.
    function test_directTransferEntersAllEightPoolsBeforeTheNextTradeIsPriced() public {
        market.fundRound(1, SEED);
        vm.prank(ALICE);
        market.buy(1, 0, true, 2000e18, 2600e18, MAX); // Skew question 0 away from its 50% seed.
        uint16 skewed = market.questionState(1, 0).currentYesBps;
        uint256 gift = 100e18 + 5;
        _donate(gift);
        IndependentOutcomeMarket.FundingPreview memory p = market.fundingPreview(1, 0);
        assertTrue(p.canFund, "trade should absorb");
        assertEq(p.totalFunding, gift);
        uint256[8] memory before = _collaterals(1);
        vm.expectEmit(true, true, false, true, address(market));
        uint256[8] memory expected;
        for (uint8 q; q < 8; ++q) {
            expected[q] = _share(gift, q);
        }
        emit RoundFunded(1, BOB, 0, gift, 0, expected); // The trader donated nothing.
        vm.prank(BOB);
        market.buy(1, 5, false, 1e18, 1e18, MAX);
        for (uint8 q; q < 8; ++q) {
            assertEq(market.questionState(1, q).activeCollateral, before[q] + expected[q] + (q == 5 ? 1e18 : 0));
            assertEq(p.allocations[q], expected[q]);
        }
        uint16 after_ = market.questionState(1, 0).currentYesBps;
        assertLt(after_, skewed, "gift must move the price toward the starting odds");
        assertGt(after_, 5000);
        assertEq(_unallocated(), 0);
        assertEq(market.pendingCarry(), 0);
    }

    function test_sellAlsoAbsorbsAndBareTriggerDistributesWithoutTrading() public {
        market.fundRound(1, SEED);
        vm.prank(ALICE);
        market.buy(1, 2, true, 10e18, 15e18, MAX);
        _donate(3e18);
        uint256[8] memory before = _collaterals(1);
        vm.prank(ALICE);
        market.sell(1, 2, true, 15e18, 5e18, MAX);
        for (uint8 q; q < 8; ++q) {
            uint256 tradeDelta = q == 2 ? 5e18 : 0;
            assertEq(market.questionState(1, q).activeCollateral + tradeDelta, before[q] + _share(3e18, q));
        }
        _donate(7e18);
        vm.prank(BOB); // Anyone may flush held contributions; no CST is pulled from the caller.
        market.fundRound(1, 0);
        assertEq(_unallocated(), 0);
        assertEq(token.balanceOf(BOB), 1e40);
    }

    // Griefing: dust cannot force eight pool writes onto traders.
    function test_subThresholdTransfersWaitWithoutTouchingOtherPools() public {
        market.fundRound(1, SEED);
        vm.warp(150);
        uint256 dust = MIN_AUTO_TOP_UP - 1;
        _donate(dust);
        assertFalse(market.fundingPreview(1, 0).canFund);
        uint256[8] memory before = _collaterals(1);
        vm.prank(ALICE);
        market.buy(1, 0, true, 1e18, 1e18, MAX);
        for (uint8 q = 1; q < 8; ++q) {
            assertEq(market.questionState(1, q).activeCollateral, before[q]);
        }
        assertEq(_unallocated(), dust);
        vm.expectRevert(IndependentOutcomeMarket.InvalidParameters.selector);
        market.fundRound(1, 0); // A bare trigger uses the same threshold.
        market.fundRound(1, 1); // Any explicit gift carries held dust with it.
        assertEq(_unallocated(), 0);
        assertEq(market.questionState(1, 7).activeCollateral, before[7] + _share(dust + 1, 7));
    }

    // R2: settled carry starts the next cycle at its first trade, with no fundRound call.
    function test_firstTradeOfANewCycleSettlesThePreviousAndStartsItsPoolsFromCarry() public {
        market.fundRound(1, SEED);
        vm.prank(ALICE);
        market.buy(1, 0, true, 100e18, 150e18, MAX);
        _close(1, 1, 100, 200);
        source.set(2, true, false, 0, 0, 200, 0);
        IndependentOutcomeMarket.FundingPreview memory p = market.fundingPreview(2, 0);
        assertTrue(p.canFund && p.needsSettlement);
        assertEq(p.totalFunding, SEED + 100e18 - 150e18);
        vm.expectEmit(true, true, false, true, address(market));
        emit RoundFunded(2, BOB, 0, 0, p.totalFunding, p.allocations); // Carry only; the trader gave nothing.
        vm.prank(BOB);
        market.buy(2, 4, true, 1e18, 1e18, MAX);
        assertTrue(market.roundState(1).settled);
        assertTrue(market.roundState(2).funded);
        assertEq(market.lastFundedRound(), 2);
        assertEq(market.pendingCarry(), 0);
        for (uint8 q; q < 8; ++q) {
            IndependentOutcomeMarket.QuestionView memory s = market.questionState(2, q);
            assertEq(s.activeCollateral, p.allocations[q] + (q == 4 ? 1e18 : 0));
            assertEq(s.initialYesBps, 5000);
        }
        vm.prank(ALICE);
        assertEq(market.claimKnown(1), 150e18);
    }

    // R3: with no cycle trading, a contribution waits and joins the next cycle's start.
    function test_contributionWithoutATradingCycleJoinsTheNextCyclesFirstFunding() public {
        market.fundRound(1, SEED);
        _close(1, 0, 100, 200);
        _donate(40e18);
        vm.expectRevert(IndependentOutcomeMarket.RoundNotOpen.selector);
        market.fundRound(1, 0);
        market.settleRound(1);
        assertEq(market.pendingCarry(), SEED);
        assertEq(_unallocated(), 40e18, "settlement must not reclassify contributions");
        source.set(2, true, false, 0, 0, 200, 0);
        // Stored carry (no settlement left to preview) must not be reported as held CST.
        IndependentOutcomeMarket.FundingPreview memory p = market.fundingPreview(2, 0);
        assertFalse(p.needsSettlement);
        assertTrue(p.canFund);
        assertEq(p.unallocated, 40e18, "stored carry is not a held contribution");
        assertEq(p.availableCarry, SEED);
        assertEq(p.carryUsed, SEED);
        assertEq(p.totalFunding, SEED + 40e18);
        assertEq(p.deferredCarry, 0);
        vm.prank(ALICE);
        market.buy(2, 1, false, 1e18, 1e18, MAX);
        for (uint8 q; q < 8; ++q) {
            assertEq(market.questionState(2, q).activeCollateral, p.allocations[q] + (q == 1 ? 1e18 : 0));
        }
        assertEq(market.totalActiveCollateral(), SEED + 40e18 + 1e18);
        assertEq(market.pendingCarry(), 0);
        assertEq(_unallocated(), 0);
    }

    function test_unsolicitedCstAloneCanStartTheFirstEverCycleOnlyAboveTheMinimum() public {
        _donate(market.MIN_FUNDING() - 1);
        vm.prank(ALICE);
        vm.expectRevert(IndependentOutcomeMarket.NotFunded.selector);
        market.buy(1, 0, true, 1e12, 1e12, MAX);
        _donate(1);
        vm.prank(ALICE);
        market.buy(1, 0, true, 1e12, 1e12, MAX);
        assertTrue(market.roundState(1).funded);
        assertEq(market.totalActiveCollateral(), market.MIN_FUNDING() + 1e12);
    }

    function test_splitAndMergeStayNeutralWhileContributionsArePending() public {
        market.fundRound(1, SEED);
        _donate(50e18);
        uint256[8] memory before = _collaterals(1);
        vm.prank(ALICE);
        market.splitPosition(1, 3, 10e18);
        vm.prank(ALICE);
        market.mergePosition(1, 3, 4e18);
        for (uint8 q; q < 8; ++q) {
            assertEq(market.questionState(1, q).activeCollateral, before[q] + (q == 3 ? 6e18 : 0));
        }
        assertEq(_unallocated(), 50e18);
    }

    // Recovery paths never absorb, never call the source, and cannot be blocked by pending CST.
    function test_mergesAndCachedClaimsIgnorePendingContributionsAndSourceOutage() public {
        market.fundRound(1, SEED);
        vm.prank(ALICE);
        market.splitPosition(1, 0, 10e18);
        vm.prank(ALICE);
        market.buy(1, 1, true, 5e18, 7e18, MAX);
        _donate(50e18);
        source.setOffline(1, true);
        vm.prank(ALICE);
        assertEq(market.mergePosition(1, 0, 3e18), 3e18);
        source.setOffline(1, false);
        _close(1, 2, 100, 200);
        market.settleRound(1);
        source.setOffline(1, true);
        vm.prank(ALICE);
        assertEq(market.mergePosition(1, 0, 2e18), 2e18);
        vm.prank(ALICE);
        assertEq(market.claimKnown(1), 5e18 + 7e18);
        assertEq(_unallocated(), 50e18);
    }

    // Capacity: implicit excess never reverts a user's trade; it waits in pendingCarry.
    // A sponsor's own CST is never deferred: it ranks before held transfers or reverts.
    function test_implicitExcessWaitsInPendingCarryWhileSponsorExcessReverts() public {
        market.fundRound(1, SEED);
        uint256 maximum = market.MAX_COLLATERAL();
        vm.prank(ALICE);
        market.splitPosition(1, 3, maximum - 1000e18 - 1e18); // Question 3 keeps 1e18 headroom.
        uint256 capacity = 8e18 + 3;
        _donate(100e18);
        vm.prank(BOB);
        market.buy(1, 0, true, 1e18, 1e18, MAX);
        assertEq(market.questionState(1, 3).activeCollateral, maximum);
        assertEq(market.pendingCarry(), 100e18 - capacity);
        assertEq(_unallocated(), 0);
        uint256 carry = market.pendingCarry();
        _donate(50e18); // Held transfers must not crowd out the sponsor below.
        // Question 3 is full: capacity is its index, 3 wei for questions 0..2.
        assertEq(market.fundingPreview(1, 0).maxNewAmount, 3);
        vm.expectRevert(IndependentOutcomeMarket.FundingCapacity.selector);
        market.fundRound(1, 4);
        uint256[8] memory expected;
        expected[0] = expected[1] = expected[2] = 1;
        vm.expectEmit(true, true, false, true, address(market));
        emit RoundFunded(1, address(this), 3, 0, 0, expected);
        market.fundRound(1, 3);
        assertEq(market.pendingCarry(), carry + 50e18, "held transfers yield to the sponsor and wait");
        assertEq(_unallocated(), 0);
    }

    // Placement priority at first funding: carry, then the sponsor's own CST, then held transfers.
    function test_firstFundingPlacesCarryThenTheSponsorThenHeldTransfers() public {
        market.fundRound(1, SEED);
        _close(1, 0, 100, 200);
        source.set(2, true, false, 0, 0, 200, 0);
        uint256 headroom = 1100e18;
        vm.prank(ALICE);
        market.splitPosition(2, 3, market.MAX_COLLATERAL() - headroom);
        uint256 capacity = 8 * headroom + 3; // Questions 0..2 take one extra wei each.
        _donate(500e18);
        IndependentOutcomeMarket.FundingPreview memory p = market.fundingPreview(2, 0);
        assertTrue(p.needsSettlement && p.canFund);
        assertEq(p.availableCarry, SEED);
        assertEq(p.carryUsed, SEED);
        assertEq(p.maxNewAmount, capacity - SEED, "held transfers never reduce the sponsor's room");
        assertEq(p.unallocated, 500e18);
        vm.expectRevert(IndependentOutcomeMarket.FundingCapacity.selector);
        market.fundRound(2, capacity - SEED + 1);
        uint256 gift = 600e18;
        p = market.fundingPreview(2, gift);
        assertTrue(p.canFund);
        assertEq(p.totalFunding, capacity);
        assertEq(p.deferredCarry, SEED + gift + 500e18 - capacity);
        uint256[8] memory expected;
        for (uint8 q; q < 8; ++q) {
            expected[q] = _share(capacity, q);
        }
        vm.expectEmit(true, true, false, true, address(market));
        emit RoundFunded(2, BOB, gift, capacity - SEED - gift, SEED, expected);
        vm.prank(BOB);
        market.fundRound(2, gift);
        assertTrue(market.roundState(1).settled);
        assertEq(market.pendingCarry(), p.deferredCarry, "only unsolicited CST was deferred");
        assertEq(market.pendingCarry(), 500e18 - (capacity - SEED - gift));
        assertEq(_unallocated(), 0);
        assertEq(token.balanceOf(address(market)), market.totalActiveCollateral() + market.pendingCarry());
    }

    function test_thresholdBoundaryForImplicitTriggersIsExactlyOneCst() public {
        market.fundRound(1, SEED);
        _donate(MIN_AUTO_TOP_UP - 1);
        vm.prank(ALICE);
        market.buy(1, 0, true, 1e18, 1e18, MAX);
        assertEq(_unallocated(), MIN_AUTO_TOP_UP - 1, "a trade absorbed below the threshold");
        _donate(1);
        assertTrue(market.fundingPreview(1, 0).canFund);
        uint256[8] memory expected;
        for (uint8 q; q < 8; ++q) {
            expected[q] = _share(MIN_AUTO_TOP_UP, q);
        }
        vm.expectEmit(true, true, false, true, address(market));
        emit RoundFunded(1, ALICE, 0, MIN_AUTO_TOP_UP, 0, expected);
        vm.prank(ALICE);
        market.sell(1, 0, true, 1e18, 1e17, MAX);
        assertEq(_unallocated(), 0);
    }

    function test_externalDestructionSaturatesAndLaterInflowsRestoreBackingFirst() public {
        market.fundRound(1, SEED);
        token.destroy(address(market), 1e18);
        // The frontend's preview saturates too instead of reverting on the deficit.
        IndependentOutcomeMarket.FundingPreview memory p = market.fundingPreview(1, 0);
        assertEq(p.unallocated, 0);
        assertFalse(p.canFund);
        _donate(5e17); // Fills half the hole; nothing is absorbed or reverted.
        p = market.fundingPreview(1, 0);
        assertEq(p.unallocated, 0);
        assertFalse(p.canFund);
        assertEq(market.fundingPreview(1, 5e18).totalFunding, 5e18 - 5e17, "preview matches the restoration below");
        vm.prank(ALICE);
        market.buy(1, 0, true, 1e18, 1e18, MAX);
        uint256 active = market.totalActiveCollateral();
        uint256[8] memory expected;
        for (uint8 q; q < 8; ++q) {
            expected[q] = _share(5e18 - 5e17, q);
        }
        vm.expectEmit(true, true, false, true, address(market));
        emit RoundFunded(1, address(this), 5e18 - 5e17, 0, 0, expected); // Event sums stay exact.
        market.fundRound(1, 5e18);
        assertEq(market.totalActiveCollateral(), active + 5e18 - 5e17);
        assertEq(token.balanceOf(address(market)), market.totalActiveCollateral() + market.pendingCarry());
    }

    // The preview is the frontend's quote basis: it must predict the absorption exactly.
    function testFuzz_previewPredictsTheAbsorptionPerformedByTheNextTrade(
        uint256 rawGift,
        uint8 rawQuestion,
        bool yes,
        bool startNextCycle
    ) public {
        uint8 question = rawQuestion % 8;
        uint256 round = 1;
        market.fundRound(1, SEED);
        if (startNextCycle) {
            _close(1, 0, 100, 200);
            source.set(2, true, false, 0, 0, 200, 0);
            round = 2;
        }
        uint256 gift = bound(rawGift, 0, 1e24);
        if (gift != 0) _donate(gift);
        IndependentOutcomeMarket.FundingPreview memory p = market.fundingPreview(round, 0);
        assertEq(p.canFund, startNextCycle || gift >= MIN_AUTO_TOP_UP);
        uint256[8] memory before = _collaterals(round);
        vm.prank(ALICE);
        market.buy(round, question, yes, 1e18, 1e18, MAX);
        for (uint8 q; q < 8; ++q) {
            uint256 expected = before[q] + (p.canFund ? p.allocations[q] : 0) + (q == question ? 1e18 : 0);
            assertEq(market.questionState(round, q).activeCollateral, expected);
        }
        if (p.canFund) assertEq(market.pendingCarry(), p.deferredCarry);
        assertEq(
            token.balanceOf(address(market)),
            market.totalActiveCollateral() + market.pendingCarry() + (p.canFund ? 0 : gift)
        );
    }

    function testFuzz_explicitGiftPreviewIncludesHeldTransfersAndMatchesExecution(
        uint256 rawHeld,
        uint256 rawGift,
        bool firstFunding
    ) public {
        if (!firstFunding) market.fundRound(1, SEED);
        uint256 held = bound(rawHeld, 0, 1e24);
        uint256 gift = bound(rawGift, firstFunding ? market.MIN_FUNDING() : 1, 1e24);
        if (held != 0) _donate(held);
        IndependentOutcomeMarket.FundingPreview memory p = market.fundingPreview(1, gift);
        assertTrue(p.canFund);
        assertEq(p.totalFunding, held + gift);
        assertEq(p.unallocated, held);
        uint256[8] memory before = _collaterals(1);
        uint256 active = market.totalActiveCollateral();
        vm.prank(BOB);
        market.fundRound(1, gift);
        for (uint8 q; q < 8; ++q) {
            assertEq(market.questionState(1, q).activeCollateral, before[q] + p.allocations[q]);
            assertEq(p.allocations[q], _share(held + gift, q));
        }
        assertEq(market.totalActiveCollateral(), active + held + gift);
        assertEq(market.pendingCarry(), p.deferredCarry);
        assertEq(token.balanceOf(address(market)), market.totalActiveCollateral() + market.pendingCarry());
    }

    /// @dev One parity property over every absorption shape: first-ever funding,
    /// top-ups, a new cycle that settles the previous one first, capacity squeezed
    /// by a split, bare and explicit `fundRound`, and a buy as the trigger.
    function testFuzz_previewMatchesExecutionAcrossCarryCapacitySettlementAndTriggers(
        uint256 rawHeld,
        uint256 rawAmount,
        uint256 rawHeadroom,
        uint8 rawQuestion,
        uint8 mode
    ) public {
        uint256 round = 1;
        if (mode & 1 == 0) {
            market.fundRound(1, SEED);
            if (mode & 2 != 0) {
                _close(1, 0, 100, 200);
                source.set(2, true, false, 0, 0, 200, 0);
                round = 2;
                if (mode & 32 != 0) market.settleRound(1); // Stored carry, nothing left to settle.
            }
        }
        uint8 tight = rawQuestion % 8;
        if (mode & 4 != 0) {
            uint256 headroom = bound(rawHeadroom, 0, 20_000e18);
            uint256 current = market.questionState(round, tight).activeCollateral;
            vm.prank(ALICE);
            market.splitPosition(round, tight, market.MAX_COLLATERAL() - current - headroom);
        }
        uint256 held = bound(rawHeld, 0, rawHeld % 2 == 0 ? 2e18 : 30_000e18);
        if (held != 0) _donate(held);
        bool trade = mode & 8 != 0;
        uint256 amount = trade || mode & 16 != 0 ? 0 : bound(rawAmount, 1, 30_000e18);
        IndependentOutcomeMarket.FundingPreview memory p = market.fundingPreview(round, amount);
        assertEq(p.unallocated, held);
        uint256[8] memory before = _collaterals(round);
        uint8 traded = (tight + 1) % 8;
        vm.recordLogs();
        vm.prank(BOB);
        if (trade) {
            if (!p.canFund && !market.roundState(round).funded) {
                vm.expectRevert(IndependentOutcomeMarket.NotFunded.selector);
                market.buy(round, traded, true, 1e18, 1e18, MAX);
                return;
            }
            market.buy(round, traded, true, 1e18, 1e18, MAX);
        } else if (amount > p.maxNewAmount) {
            vm.expectRevert(IndependentOutcomeMarket.FundingCapacity.selector);
            market.fundRound(round, amount);
            return;
        } else if (!p.canFund) {
            vm.expectRevert(IndependentOutcomeMarket.InvalidParameters.selector);
            market.fundRound(round, amount);
            return;
        } else {
            market.fundRound(round, amount);
        }
        for (uint8 q; q < 8; ++q) {
            uint256 added = p.canFund ? p.allocations[q] : 0;
            uint256 bought = trade && q == traded ? 1e18 : 0;
            assertEq(market.questionState(round, q).activeCollateral, before[q] + added + bought);
        }
        assertEq(_unallocated(), p.canFund ? 0 : held, "held CST neither placed nor deferred");
        if (p.canFund) {
            assertEq(market.pendingCarry(), p.deferredCarry);
            assertTrue(market.roundState(round).funded);
            if (p.needsSettlement) assertTrue(market.roundState(1).settled);
        }
        uint256 events;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] != RoundFunded.selector) continue;
            ++events;
            (uint256 donated, uint256 transfersUsed, uint256 carryUsed, uint256[8] memory allocations) =
                abi.decode(logs[i].data, (uint256, uint256, uint256, uint256[8]));
            assertEq(address(uint160(uint256(logs[i].topics[2]))), BOB);
            assertEq(donated, amount);
            assertEq(carryUsed, p.carryUsed);
            assertEq(donated + transfersUsed + carryUsed, p.totalFunding);
            assertLe(transfersUsed, held);
            for (uint8 q; q < 8; ++q) {
                assertEq(allocations[q], p.allocations[q]);
            }
        }
        assertEq(events, p.canFund ? 1 : 0);
    }

    // Absorb-before-pricing: a transfer then a trade is indistinguishable from an
    // explicit gift then the same trade, so no trade can capture a pending gift.
    // The trade is the tightest quote against the gifted pool; each gift makes it
    // better than the pre-gift pool allows, so pricing before absorbing reverts.
    function testFuzz_transferThenTradeLeavesTheSameStateAsFundThenTrade(uint256 rawGift, bool nextCycle, bool sell)
        public
    {
        market.fundRound(1, SEED);
        vm.prank(BOB);
        market.buy(1, 6, true, 300e18, 450e18, MAX); // YES on question 6 is now dear, NO cheap.
        uint256 round = 1;
        if (nextCycle) {
            _close(1, 0, 100, 200);
            source.set(2, true, false, 0, 0, 200, 0);
            round = 2;
        }
        vm.prank(BOB);
        market.splitPosition(round, 6, 10e18); // NO to sell; never starts cycle 2.
        uint256 gift = bound(rawGift, MIN_AUTO_TOP_UP, 1e24);
        vm.warp(block.timestamp + 7);
        uint256 snapshot = vm.snapshotState();
        vm.prank(DONOR);
        market.fundRound(round, gift);
        // A cheaper YES buys more units; a dearer NO sells for more CST.
        uint256 quote = _tightest(round, 6, !sell, sell, 1e18);
        _tradeQuestionSix(round, sell, quote);
        bytes32 viaFunding = _fingerprint(round, BOB);
        assertTrue(vm.revertToState(snapshot));
        _donate(gift);
        _tradeQuestionSix(round, sell, quote);
        assertEq(_fingerprint(round, BOB), viaFunding);
        assertEq(_unallocated(), 0);
    }

    function _tradeQuestionSix(uint256 round, bool sell, uint256 quote) private {
        vm.prank(BOB);
        if (sell) market.sell(round, 6, false, 1e18, quote, MAX);
        else market.buy(round, 6, true, 1e18, quote, MAX);
    }

    /// @dev Everything later callers can observe about `round`, `trader` and custody.
    function _fingerprint(uint256 round, address trader) private view returns (bytes32 hash) {
        (uint256[8] memory yes, uint256[8] memory no) = market.balancesOf(round, trader);
        hash = keccak256(
            abi.encode(
                market.questionStates(round),
                market.roundState(round),
                market.roundState(1),
                market.totalActiveCollateral(),
                market.pendingCarry(),
                market.lastFundedRound(),
                token.balanceOf(address(market)),
                token.balanceOf(address(market.settlementVault())),
                token.balanceOf(trader),
                token.balanceOf(DONOR),
                yes,
                no
            )
        );
    }

    /// @dev Tightest quote BOB can fill now (state restored): the most units a buy
    /// of `amount` CST receives, or the most CST a sell of `amount` units receives.
    function _tightest(uint256 round, uint8 q, bool yes, bool sell, uint256 amount) private returns (uint256 low) {
        uint256 high = sell ? amount : 100 * amount;
        while (low < high) {
            uint256 middle = (low + high + 1) / 2;
            uint256 snapshot = vm.snapshotState();
            try this.tradeFor(round, q, yes, sell, amount, middle) {
                low = middle;
            } catch {
                high = middle - 1;
            }
            assertTrue(vm.revertToStateAndDelete(snapshot));
        }
    }

    /// @dev External so `_tightest` can try a BOB trade.
    function tradeFor(uint256 round, uint8 q, bool yes, bool sell, uint256 amount, uint256 quote) external {
        vm.prank(BOB);
        if (sell) market.sell(round, q, yes, amount, quote, MAX);
        else market.buy(round, q, yes, amount, quote, MAX);
    }

    function _maxUnits(uint256 round, uint8 q, bool yes, uint256 cash) private returns (uint256) {
        return _tightest(round, q, yes, false, cash);
    }

    // Exact-amount trades: a gift landing between quote and inclusion makes a quote
    // it worsened revert, and one it improved still fills at exactly the quote.
    function test_aGiftBetweenQuoteAndInclusionRevertsWorseQuotesAndNeverFillsWorse() public {
        market.fundRound(1, SEED);
        vm.prank(ALICE);
        market.buy(1, 1, false, 900e18, 1300e18, MAX); // NO is dear, YES is cheap.
        uint256 cash = 10e18;
        uint256 yesQuote = _maxUnits(1, 1, true, cash);
        uint256 noQuote = _maxUnits(1, 1, false, cash);
        _donate(8000e18); // Pulls question 1 back toward its 50% seed.
        assertLt(_maxUnits(1, 1, true, cash), yesQuote);
        assertGt(_maxUnits(1, 1, false, cash), noQuote);
        uint256 wallet = token.balanceOf(BOB);
        vm.prank(BOB);
        vm.expectRevert(IndependentOutcomeMarket.ProductWouldDecrease.selector);
        market.buy(1, 1, true, cash, yesQuote, MAX);
        assertEq(_unallocated(), 8000e18, "the failed trade's absorption was not rolled back");
        vm.prank(BOB);
        market.buy(1, 1, false, cash, noQuote, MAX);
        assertEq(token.balanceOf(BOB), wallet - cash);
        assertEq(market.balanceOf(BOB, market.positionId(1, 1, false)), noQuote);
        assertEq(market.balanceOf(BOB, market.positionId(1, 1, true)), 0);
        assertEq(_unallocated(), 0);
    }

    function test_tradeOnAnEarlierUnfundedCycleRevertsOutOfOrderAndHeldCstWaits() public {
        source.set(2, true, false, 0, 0, 100, 0); // Both cycles report open.
        market.fundRound(2, SEED);
        _donate(100e18);
        assertFalse(market.fundingPreview(1, 0).canFund);
        vm.prank(ALICE);
        vm.expectRevert(IndependentOutcomeMarket.OutOfOrderRound.selector);
        market.buy(1, 0, true, 1e18, 1e18, MAX);
        vm.expectRevert(IndependentOutcomeMarket.OutOfOrderRound.selector);
        market.fundRound(1, 0);
        vm.expectRevert(IndependentOutcomeMarket.OutOfOrderRound.selector);
        market.fundRound(1, SEED);
        assertFalse(market.roundState(1).initialized);
        assertEq(_unallocated(), 100e18);
        vm.prank(ALICE);
        market.buy(2, 0, true, 1e18, 1e18, MAX); // The live cycle takes it instead.
        assertEq(market.totalActiveCollateral(), SEED + 100e18 + 1e18);
        assertEq(_unallocated(), 0);
    }

    // A trade that starts a cycle first settles the previous one; every error of that
    // settlement surfaces from the trade and rolls the whole start back.
    function test_firstTradeOfACycleSurfacesPreviousSettlementErrorsAtomically() public {
        market.fundRound(1, SEED);
        vm.prank(ALICE);
        market.buy(1, 0, true, 100e18, 150e18, MAX);
        vm.warp(200);
        source.set(2, true, false, 0, 0, 200, 0);
        _donate(50e18);
        bytes4[3] memory errors = [
            IndependentOutcomeMarket.NotFinalized.selector,
            IndependentOutcomeMarket.InvalidSourceState.selector,
            IndependentUnitSource.SourceOffline.selector
        ];
        for (uint256 i; i < errors.length; ++i) {
            uint256 snapshot = vm.snapshotState();
            if (i == 0) source.set(1, false, false, 255, 1, 100, 0); // Closed, not yet final.
            else if (i == 1) source.set(1, false, true, 127, 1, 100, 200); // Final without every answer.
            else source.setOffline(1, true);
            try market.fundingPreview(2, 0) returns (IndependentOutcomeMarket.FundingPreview memory p) {
                assertFalse(p.canFund, "preview promised a start the trade cannot make");
            } catch {}
            vm.prank(BOB);
            vm.expectRevert(errors[i]);
            market.buy(2, 0, true, 1e18, 1e18, MAX);
            vm.expectRevert(errors[i]);
            market.fundRound(2, 0);
            assertFalse(market.roundState(1).settled);
            assertFalse(market.roundState(2).initialized);
            assertEq(market.pendingCarry(), 0);
            assertEq(_unallocated(), 50e18);
            assertTrue(vm.revertToState(snapshot));
        }
        _close(1, 1, 100, 200);
        vm.prank(BOB);
        market.buy(2, 0, true, 1e18, 1e18, MAX);
        assertTrue(market.roundState(1).settled && market.roundState(2).funded);
    }

    function test_aClosedCycleThatNeverStartedReportsRoundNotOpenToTraders() public {
        _donate(100e18);
        _close(1, 0, 100, 200);
        assertFalse(market.fundingPreview(1, 0).canFund);
        vm.prank(ALICE);
        vm.expectRevert(IndependentOutcomeMarket.RoundNotOpen.selector);
        market.buy(1, 0, true, 1e18, 1e18, MAX);
        vm.expectRevert(IndependentOutcomeMarket.RoundNotOpen.selector);
        market.fundRound(1, 0);
        assertEq(_unallocated(), 100e18);
    }

    function test_aSellOfSplitPairsStartsAnUnfundedCycleBeforePricing() public {
        vm.prank(ALICE);
        market.splitPosition(1, 3, 5e18);
        _donate(80e18);
        vm.prank(ALICE);
        market.splitPosition(1, 3, 1e18);
        assertFalse(market.roundState(1).funded, "a split started the cycle");
        assertEq(_unallocated(), 80e18, "a split absorbed held CST");
        uint256[8] memory expected;
        for (uint8 q; q < 8; ++q) {
            expected[q] = 10e18;
        }
        vm.expectEmit(true, true, false, true, address(market));
        emit RoundFunded(1, ALICE, 0, 80e18, 0, expected);
        vm.prank(ALICE); // Unpriceable before the start: the split-only pool has no reserves.
        market.sell(1, 3, true, 1e18, 1e17, MAX);
        assertTrue(market.roundState(1).funded);
        for (uint8 q; q < 8; ++q) {
            assertEq(market.questionState(1, q).activeCollateral, q == 3 ? 6e18 + 10e18 - 1e17 : 10e18);
        }
        assertEq(_unallocated(), 0);
    }

    function _marketTopics() private view returns (bytes32[] memory topics) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        topics = new bytes32[](logs.length);
        uint256 count;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(market)) topics[count++] = logs[i].topics[0];
        }
        assembly ("memory-safe") {
            mstore(topics, count)
        }
    }

    function _assertTopics(bytes32[] memory actual, bytes32[] memory expected) private pure {
        assertEq(actual.length, expected.length, "market event count");
        for (uint256 i; i < expected.length; ++i) {
            assertEq(actual[i], expected[i]);
        }
    }

    // Consumers read one ordering: settlement, initialization and funding precede the trade.
    function test_tradeTriggeredFundingEventsPrecedeTheTradeInOneFixedOrder() public {
        bytes32 answers = keccak256("AnswersObserved(uint256,uint8,uint8)");
        bytes32 settled = keccak256("RoundSettled(uint256,uint8,uint256[8],uint256)");
        bytes32 initialized = keccak256("RoundInitialized(uint256)");
        bytes32 funded = RoundFunded.selector;
        bytes32 single = keccak256("TransferSingle(address,address,address,uint256,uint256)");
        bytes32 traded = keccak256("Trade(uint256,address,uint8,bool,bool,uint256,uint256)");
        market.fundRound(1, SEED);
        vm.prank(ALICE);
        market.buy(1, 0, true, 100e18, 150e18, MAX);
        _donate(MIN_AUTO_TOP_UP - 1);
        vm.recordLogs();
        vm.prank(ALICE);
        market.sell(1, 0, true, 1e18, 1e17, MAX); // Below the threshold: no funding event.
        _assertTopics(_marketTopics(), _pair(single, traded));
        _donate(1);
        vm.recordLogs();
        vm.prank(ALICE);
        market.sell(1, 0, true, 1e18, 1e17, MAX);
        bytes32[] memory expected = new bytes32[](3);
        (expected[0], expected[1], expected[2]) = (funded, single, traded);
        _assertTopics(_marketTopics(), expected);
        _close(1, 1, 100, 200);
        source.set(2, true, false, 0, 0, 200, 0);
        _donate(3e18);
        vm.recordLogs();
        vm.prank(BOB);
        market.buy(2, 4, true, 1e18, 1e18, MAX);
        expected = new bytes32[](6);
        (expected[0], expected[1], expected[2]) = (answers, settled, initialized);
        (expected[3], expected[4], expected[5]) = (funded, single, traded);
        _assertTopics(_marketTopics(), expected);
    }

    function _pair(bytes32 a, bytes32 b) private pure returns (bytes32[] memory result) {
        result = new bytes32[](2);
        (result[0], result[1]) = (a, b);
    }

    // Splits neither absorb nor start a cycle, and change nothing the next trade absorbs.
    function testFuzz_aSplitBeforeTheTradeDoesNotChangeWhatTheTradeAbsorbs(
        uint256 rawHeld,
        uint256 rawSplit,
        uint8 rawSplitQuestion,
        uint8 rawTradeQuestion,
        bool nextCycle
    ) public {
        market.fundRound(1, SEED);
        uint256 round = 1;
        if (nextCycle) {
            _close(1, 0, 100, 200);
            source.set(2, true, false, 0, 0, 200, 0);
            round = 2;
        }
        uint256 held = bound(rawHeld, 0, 1e24);
        if (held != 0) _donate(held);
        uint8 splitQuestion = rawSplitQuestion % 8;
        uint8 tradeQuestion = rawTradeQuestion % 8;
        uint256 amount = bound(rawSplit, 1, 1e24);
        uint256 snapshot = vm.snapshotState();
        vm.prank(ALICE);
        market.buy(round, tradeQuestion, true, 1e18, 1e18, MAX);
        uint256[8] memory plain = _collaterals(round);
        uint256 carry = market.pendingCarry();
        assertTrue(vm.revertToState(snapshot));
        vm.prank(ALICE);
        market.splitPosition(round, splitQuestion, amount);
        assertEq(market.roundState(round).funded, !nextCycle, "a split started the cycle");
        assertEq(_unallocated(), held, "a split absorbed held CST");
        vm.prank(ALICE);
        market.buy(round, tradeQuestion, true, 1e18, 1e18, MAX);
        uint256[8] memory afterSplit = _collaterals(round);
        for (uint8 q; q < 8; ++q) {
            assertEq(afterSplit[q] - (q == splitQuestion ? amount : 0), plain[q]);
        }
        assertEq(market.pendingCarry(), carry);
        assertEq(_unallocated(), nextCycle || held >= MIN_AUTO_TOP_UP ? 0 : held);
    }

    /// @dev Inflows arrive as transfers and mints in several pieces; only their sum
    /// counts. Implicit triggers (buy, sell, bare fundRound) absorb from exactly
    /// MIN_AUTO_TOP_UP; an explicit gift of 1 wei always sweeps.
    function testFuzz_implicitTriggersAbsorbHeldCstExactlyFromTheThreshold(
        bool reach,
        uint8 rawParts,
        uint8 rawTrigger,
        uint8 rawQuestion
    ) public {
        market.fundRound(1, SEED);
        uint8 question = rawQuestion % 8;
        vm.prank(ALICE);
        market.buy(1, question, true, 10e18, 10e18, MAX);
        uint256 held = MIN_AUTO_TOP_UP - 1 + (reach ? 1 : 0);
        uint256 parts = 1 + rawParts % 4;
        for (uint256 i; i < parts; ++i) {
            uint256 part = i + 1 == parts ? held - (parts - 1) * (held / parts) : held / parts;
            if (i % 2 == 0) _donate(part);
            else token.mint(address(market), part);
        }
        uint8 trigger = rawTrigger % 4;
        bool absorbs = reach || trigger == 3;
        uint256 placed = held + (trigger == 3 ? 1 : 0);
        assertEq(market.fundingPreview(1, 0).canFund, reach);
        assertTrue(market.fundingPreview(1, 1).canFund);
        uint256[8] memory before = _collaterals(1);
        address caller = trigger == 1 ? ALICE : BOB;
        vm.recordLogs();
        vm.prank(caller);
        if (trigger == 0) {
            market.buy(1, question, false, 1e18, 1e18, MAX);
        } else if (trigger == 1) {
            market.sell(1, question, true, 1e18, 1e17, MAX);
        } else if (trigger == 2 && !reach) {
            vm.expectRevert(IndependentOutcomeMarket.InvalidParameters.selector);
            market.fundRound(1, 0);
        } else {
            market.fundRound(1, trigger == 3 ? 1 : 0);
        }
        uint256 events;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] != RoundFunded.selector) continue;
            ++events;
            (uint256 donated, uint256 transfersUsed, uint256 carryUsed,) =
                abi.decode(logs[i].data, (uint256, uint256, uint256, uint256[8]));
            assertEq(address(uint160(uint256(logs[i].topics[2]))), caller);
            assertEq(donated, trigger == 3 ? 1 : 0);
            assertEq(transfersUsed, held);
            assertEq(carryUsed, 0);
        }
        assertEq(events, absorbs ? 1 : 0);
        for (uint8 q; q < 8; ++q) {
            if (q == question) continue;
            assertEq(market.questionState(1, q).activeCollateral, before[q] + (absorbs ? _share(placed, q) : 0));
        }
        assertEq(_unallocated(), absorbs ? 0 : held);
        assertEq(market.pendingCarry(), 0);
    }

    function _coldBuy(uint256 round, uint8 q) private returns (uint256 used) {
        vm.cool(address(market));
        vm.cool(address(token));
        vm.cool(address(source));
        vm.prank(ALICE);
        uint256 beforeGas = gasleft();
        market.buy(round, q, true, 100e18, 150e18, MAX);
        used = beforeGas - gasleft();
    }

    function test_gasOfBuyWithAndWithoutPendingContributions() public {
        market.fundRound(1, SEED);
        uint256 snap = vm.snapshotState();
        vm.warp(101);
        uint256 plain = _coldBuy(1, 0);
        assertTrue(vm.revertToState(snap));
        _donate(1e17); // below threshold: held, ignored
        vm.warp(101);
        uint256 dust = _coldBuy(1, 0);
        assertTrue(vm.revertToState(snap));
        _donate(100e18);
        vm.warp(101);
        uint256 absorbing = _coldBuy(1, 0);
        assertTrue(vm.revertToState(snap));
        _close(1, 0, 100, 200);
        source.set(2, true, false, 0, 0, 200, 0);
        vm.warp(201);
        uint256 starting = _coldBuy(2, 0);
        emit log_named_uint("cold buy, nothing pending", plain);
        emit log_named_uint("cold buy, sub-threshold held", dust);
        emit log_named_uint("cold buy, absorbs 100 CST into 8 pools", absorbing);
        emit log_named_uint("cold first buy: settles previous, starts cycle from carry", starting);
        assertLt(plain, 1_000_000);
        assertLt(starting, 2_000_000);
    }
}
