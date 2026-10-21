// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IndependentOutcomeMarket, IIndependentCollateral} from "../src/IndependentOutcomeMarket.sol";
import {OutcomeSettlementVault} from "../src/OutcomeSettlementVault.sol";
import {BinaryMarketMath} from "../src/libraries/BinaryMarketMath.sol";
import {IndependentOracleSource} from "./IndependentMarketInvariant.t.sol";
import {MockCst} from "./utils/Mocks.sol";

contract IndependentAuditToken is MockCst {
    address public taxedRecipient;
    address private _callbackTarget;
    bytes private _callbackData;
    bool private _insideCallback;
    uint256 public callbackCount;
    uint256 public callbackSuccesses;
    bool public wrongCallbackRevert;

    function tax(address recipient) external {
        taxedRecipient = recipient;
    }

    function arm(address target, bytes memory payload) external {
        _callbackTarget = target;
        _callbackData = payload;
        callbackCount = 0;
        callbackSuccesses = 0;
        wrongCallbackRevert = false;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        super.transfer(to, amount);
        if (to == taxedRecipient && amount != 0) --balanceOf[to];
        _attack();
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        super.transferFrom(from, to, amount);
        _attack();
        return true;
    }

    function _attack() private {
        if (_callbackTarget == address(0) || _insideCallback) return;
        _insideCallback = true;
        ++callbackCount;
        (bool ok, bytes memory reason) = _callbackTarget.call(_callbackData);
        if (ok) ++callbackSuccesses;
        else if (bytes4(reason) != IndependentOutcomeMarket.ReentrantCall.selector) wrongCallbackRevert = true;
        _insideCallback = false;
    }
}

contract IndependentAuditReceiver is IERC1155Receiver {
    IndependentOutcomeMarket public immutable market;
    address public immutable beneficiary;
    uint256 public blocked;
    bool private _inside;

    constructor(IndependentOutcomeMarket m, MockCst token, address beneficiary_) {
        market = m;
        beneficiary = beneficiary_;
        token.approve(address(m), type(uint256).max);
    }

    function buy() external {
        market.buy(1, 0, true, 10e18, 15e18, type(uint256).max);
    }

    function split() external {
        market.splitPosition(1, 1, 9e18);
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == type(IERC1155Receiver).interfaceId || id == type(IERC165).interfaceId;
    }

    function onERC1155Received(address, address, uint256 id, uint256 amount, bytes calldata) external returns (bytes4) {
        require(msg.sender == address(market));
        _probe();
        market.safeTransferFrom(address(this), beneficiary, id, amount, "forward");
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata ids,
        uint256[] calldata amounts,
        bytes calldata
    ) external returns (bytes4) {
        require(msg.sender == address(market));
        _probe();
        market.safeBatchTransferFrom(address(this), beneficiary, ids, amounts, "forward");
        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }

    function _probe() private {
        if (_inside) return;
        _inside = true;
        uint256[8] memory amounts;
        amounts[1] = 1;
        bytes[9] memory attempts = [
            abi.encodeCall(market.fundRound, (1, 1)),
            abi.encodeCall(market.fundRound, (1, 0)),
            abi.encodeCall(market.buy, (1, 0, true, 1, 1, type(uint256).max)),
            abi.encodeCall(market.sell, (1, 0, true, 1, 1, type(uint256).max)),
            abi.encodeCall(market.splitPosition, (1, 0, 1)),
            abi.encodeCall(market.mergePosition, (1, 1, 1)),
            abi.encodeCall(market.mergePositions, (1, amounts)),
            abi.encodeCall(market.settleRound, (1)),
            abi.encodeCall(market.claimKnown, (1))
        ];
        for (uint256 i; i < attempts.length; ++i) {
            (bool success, bytes memory reason) = address(market).call(attempts[i]);
            require(!success && bytes4(reason) == IndependentOutcomeMarket.ReentrantCall.selector, "financial reentry");
            ++blocked;
        }
        _inside = false;
    }
}

contract IndependentMarketAuditTest is Test {
    IndependentOutcomeMarket private market;
    IndependentOracleSource private source;
    IndependentAuditToken private token;
    OutcomeSettlementVault private vault;
    address private constant ALICE = address(0xa11ce);
    address private constant BOB = address(0xb0b);
    address private constant CAROL = address(0xca901);
    uint256 private constant SEED = 800e18 + 5;

    function setUp() public {
        vm.warp(1000);
        source = new IndependentOracleSource();
        source.set(1, true, false, 0, 0, 1000, 0);
        token = new IndependentAuditToken();
        market = new IndependentOutcomeMarket(IIndependentCollateral(address(token)), source);
        vault = market.settlementVault();
        token.mint(address(this), 16 * market.MAX_ROUND_COLLATERAL());
        token.mint(ALICE, market.MAX_COLLATERAL());
        token.mint(BOB, market.MAX_COLLATERAL());
        token.approve(address(market), type(uint256).max);
        vm.prank(ALICE);
        token.approve(address(market), type(uint256).max);
        vm.prank(BOB);
        token.approve(address(market), type(uint256).max);
        market.fundRound(1, SEED);
    }

    function test_singleFundingAndLaterGiftsAllocateEveryRemainderWei() public {
        for (uint8 q; q < 8; ++q) {
            IndependentOutcomeMarket.QuestionView memory p = market.questionState(1, q);
            assertEq(p.activeCollateral, SEED / 8 + (q < 5 ? 1 : 0));
            assertEq(p.currentYesBps, 5000);
        }
        market.fundRound(1, 11);
        uint256 sum;
        for (uint8 q; q < 8; ++q) {
            IndependentOutcomeMarket.QuestionView memory p = market.questionState(1, q);
            assertEq(p.activeCollateral, SEED / 8 + (q < 5 ? 1 : 0) + 1 + (q < 3 ? 1 : 0));
            assertEq(p.initialYesBps, 5000);
            sum += p.activeCollateral;
        }
        assertEq(sum, SEED + 11);
        assertEq(market.totalActiveCollateral(), sum);
        assertEq(token.balanceOf(address(market)), sum);
    }

    function test_publicKnownAnswerStillTradesButCannotClaimBeforeGameClosure() public {
        source.set(1, true, false, 1, 1, 1000, 0);
        vm.prank(ALICE);
        market.buy(1, 0, true, 10e18, 15e18, type(uint256).max);
        assertEq(market.roundState(1).knownMask, 1);
        assertLt(market.questionState(1, 0).currentYesBps, 10_000);
        (bool ready, uint256 preview,) = market.previewClaim(1, ALICE);
        assertFalse(ready);
        assertEq(preview, 0);
        vm.prank(ALICE);
        vm.expectRevert(IndependentOutcomeMarket.NotFinalized.selector);
        market.claimKnown(1);
        assertEq(market.balanceOf(ALICE, market.positionId(1, 0, true)), 15e18);
        assertEq(vault.totalEscrowed(), 0);
    }

    function test_oneQuestionCannotSpendTheOtherSevenQuestionsBacking() public {
        IndependentOutcomeMarket.QuestionView memory p = market.questionState(1, 0);
        bytes32 before_ = keccak256(abi.encode(market.questionStates(1)));
        vm.prank(ALICE);
        vm.expectRevert(BinaryMarketMath.NonPositiveReserve.selector);
        market.buy(1, 0, true, 1e18, p.activeCollateral + 1e18, type(uint256).max);
        assertEq(keccak256(abi.encode(market.questionStates(1))), before_);
    }

    function test_closedCycleMergesRemainAvailableWithoutTheSource() public {
        vm.prank(ALICE);
        market.splitPosition(1, 0, 10e18);
        _close(1, 1100, 1);
        source.setUnavailable(1, true);
        vm.warp(1_000_000);
        vm.prank(ALICE);
        assertEq(market.mergePosition(1, 0, 7e18), 7e18);
        source.setUnavailable(1, false);
        (uint256 debt, uint256 carried) = market.settleRound(1);
        assertEq(debt, 3e18);
        assertEq(carried, SEED);
    }

    function test_settlementSeparatesOneToOneClaimsAllSurplusAndUntrackedDonations() public {
        vm.prank(ALICE);
        market.buy(1, 0, true, 10e18, 15e18, type(uint256).max);
        vm.prank(BOB);
        market.splitPosition(1, 1, 20e18);
        token.transfer(address(market), 17);
        token.transfer(address(vault), 19);
        _close(1, 1100, 1);
        (uint256 debt, uint256 carried) = market.settleRound(1);
        assertEq(debt, 35e18);
        assertEq(carried, SEED - 5e18);
        assertEq(market.totalActiveCollateral(), 0);
        assertEq(market.pendingCarry(), carried);
        assertEq(vault.remaining(1, 0), 15e18);
        assertEq(vault.remaining(1, 1), 20e18);
        assertEq(token.balanceOf(address(market)), carried + 17);
        assertEq(token.balanceOf(address(vault)), debt + 19);
        source.setUnavailable(1, true);
        uint256 beforeAlice = token.balanceOf(ALICE);
        vm.prank(ALICE);
        assertEq(market.claimKnown(1), 15e18);
        assertEq(token.balanceOf(ALICE) - beforeAlice, 15e18, "winning units received an unintended surplus bonus");
        vm.prank(BOB);
        assertEq(market.claimKnown(1), 20e18);
        assertEq(vault.totalEscrowed(), 0);
        assertEq(token.balanceOf(address(vault)), 19);
        (debt, carried) = market.settleRound(1);
        assertEq(debt, 0);
        assertEq(carried, 0);
        assertEq(market.pendingCarry(), SEED - 5e18);
        vm.prank(ALICE);
        assertEq(market.claimKnown(1), 0);
        // The sub-threshold market donation stayed held through settlement, never
        // carry, and joins the next cycle's first funding; vault donations stay inert.
        _open(2, 1101);
        market.fundRound(2, 0);
        assertEq(market.totalActiveCollateral(), SEED - 5e18 + 17);
        assertEq(market.pendingCarry(), 0);
        assertEq(token.balanceOf(address(market)), SEED - 5e18 + 17);
        assertEq(token.balanceOf(address(vault)), 19);
    }

    function test_zeroCashFundingSkipsSplitOnlyCyclesWithoutReusingTheirCollateral() public {
        vm.prank(ALICE);
        market.buy(1, 0, true, 10e18, 15e18, type(uint256).max);
        _close(1, 1100, 1);
        _open(2, 1101);
        vm.prank(BOB);
        market.splitPosition(2, 7, 9e18);
        uint256 position = market.positionId(2, 7, true);
        vm.prank(BOB);
        market.safeTransferFrom(BOB, CAROL, position, 9e18, "gift");
        _close(2, 1200, 128);
        _open(3, 1201);
        IndependentOutcomeMarket.FundingPreview memory preview = market.fundingPreview(3, 0);
        assertTrue(preview.needsSettlement);
        assertTrue(preview.canFund);
        assertEq(preview.carryUsed, SEED - 5e18);
        market.fundRound(3, 0);
        assertEq(market.pendingCarry(), 0);
        assertEq(market.totalActiveCollateral(), SEED - 5e18 + 9e18);
        assertFalse(market.roundState(2).settled);
        bytes32 cycle3 = keccak256(abi.encode(market.questionStates(3)));
        (uint256 debt, uint256 residue) = market.settleRound(2);
        assertEq(debt, 9e18);
        assertEq(residue, 0);
        source.setUnavailable(1, true);
        source.setUnavailable(2, true);
        vm.prank(CAROL);
        assertEq(market.claimKnown(2), 9e18);
        vm.prank(ALICE);
        assertEq(market.claimKnown(1), 15e18);
        vm.prank(BOB);
        assertEq(market.claimKnown(2), 0);
        assertEq(keccak256(abi.encode(market.questionStates(3))), cycle3);
        assertEq(market.totalActiveCollateral(), SEED - 5e18);
        assertEq(token.balanceOf(address(vault)), 0);
    }

    function test_nextCycleStartsAtFiftyFiftyWhenThePreviousSourceIsUnavailableAfterSettlement() public {
        vm.warp(1040);
        vm.prank(ALICE);
        market.buy(1, 0, true, 10e18, 15e18, type(uint256).max);
        uint16 firstPrice = market.questionState(1, 0).currentYesBps;
        vm.warp(1050);
        vm.prank(ALICE);
        market.buy(1, 0, true, 10e18, 15e18, type(uint256).max);
        uint16 secondPrice = market.questionState(1, 0).currentYesBps;
        assertEq(firstPrice, 5365);
        assertEq(secondPrice, 5714);
        _close(1, 1100, 1);
        vm.warp(1_000_000);
        market.settleRound(1);
        source.setUnavailable(1, true);
        _open(2, 1_000_001);
        market.fundRound(2, 0);
        IndependentOutcomeMarket.QuestionView memory p = market.questionState(2, 0);
        assertEq(p.initialYesBps, 5000);
        assertEq(p.currentYesBps, p.initialYesBps);
    }

    function test_deferredCarrySurvivesCurrentTradesAndGiftsAndFundsTheFollowingCycle() public {
        uint256 maximum = market.MAX_COLLATERAL();
        uint256 additional = 8 * (maximum - (SEED / 8 + 1));
        market.fundRound(1, additional);
        _close(1, 1100, 0);
        (, uint256 originalCarry) = market.settleRound(1);
        assertEq(originalCarry, 8 * maximum - 3);
        _open(2, 1101);
        vm.expectRevert(IndependentOutcomeMarket.FundingCapacity.selector);
        market.fundRound(2, 1); // Carry has priority over unnecessary new CST.
        assertFalse(market.roundState(2).initialized);
        market.fundRound(2, 0);
        uint256 used = 4 * maximum;
        assertEq(market.totalActiveCollateral(), used);
        assertEq(market.pendingCarry(), originalCarry - used);
        vm.prank(ALICE);
        market.buy(2, 0, true, 1e18, 1e18, type(uint256).max);
        market.fundRound(2, 8);
        assertEq(market.pendingCarry(), originalCarry - used, "current operations consumed deferred carry");
        _close(2, 1200, 0);
        _open(3, 1201);
        market.fundRound(3, 0);
        assertEq(market.totalActiveCollateral(), used);
        assertEq(market.pendingCarry(), originalCarry + 1e18 + 8 - used);
        assertEq(token.balanceOf(address(market)), market.totalActiveCollateral() + market.pendingCarry());
    }

    function test_shortSettlementTransferCannotHideBehindVaultDonations() public {
        vm.prank(ALICE);
        market.buy(1, 0, true, 10e18, 15e18, type(uint256).max);
        token.transfer(address(vault), 1e18);
        _close(1, 1100, 1);
        token.tax(address(vault));
        vm.expectRevert(IndependentOutcomeMarket.TransferFailed.selector);
        market.settleRound(1);
        assertFalse(market.roundState(1).settled);
        assertEq(market.totalActiveCollateral(), SEED + 10e18);
        assertEq(market.pendingCarry(), 0);
        assertEq(vault.totalEscrowed(), 0);
        assertFalse(vault.registered(1));
        assertEq(token.balanceOf(address(vault)), 1e18);
    }

    function test_autoStartingTradeSurfacesAShortSettlementTransferAtomically() public {
        vm.prank(ALICE);
        market.buy(1, 0, true, 10e18, 15e18, type(uint256).max);
        _close(1, 1100, 1);
        _open(2, 1101);
        token.transfer(address(market), 3e18);
        token.tax(address(vault));
        vm.prank(BOB);
        vm.expectRevert(IndependentOutcomeMarket.TransferFailed.selector);
        market.buy(2, 0, true, 1e18, 1e18, type(uint256).max);
        assertFalse(market.roundState(1).settled);
        assertFalse(market.roundState(2).initialized);
        assertEq(market.totalActiveCollateral(), SEED + 10e18);
        assertEq(market.pendingCarry(), 0);
        assertEq(token.balanceOf(address(market)), SEED + 10e18 + 3e18);
        assertEq(vault.totalEscrowed(), 0);
        token.tax(address(0));
        vm.prank(BOB);
        market.buy(2, 0, true, 1e18, 1e18, type(uint256).max);
        assertEq(vault.totalEscrowed(), 15e18);
        assertEq(market.totalActiveCollateral(), SEED + 10e18 - 15e18 + 3e18 + 1e18);
        assertEq(token.balanceOf(address(market)), market.totalActiveCollateral() + market.pendingCarry());
    }

    function test_initialCarryCapacityRespectsExistingPairsAndTheFirstTightQuestion() public {
        _close(1, 1100, 0);
        _open(2, 1101);
        uint256 splitAmount = market.MAX_COLLATERAL() - 1e12;
        vm.prank(ALICE);
        market.splitPosition(2, 3, splitAmount);
        // Q3 is the first question with only 1e12 headroom. The three earlier
        // questions can each receive the remainder's extra wei, but Q3 cannot.
        uint256 capacity = 8e12 + 3;
        IndependentOutcomeMarket.FundingPreview memory preview = market.fundingPreview(2, 0);
        assertTrue(preview.canFund);
        assertEq(preview.carryUsed, capacity);
        assertEq(preview.deferredCarry, SEED - capacity);
        market.fundRound(2, 0);
        for (uint8 q; q < 8; ++q) {
            uint256 expected = 1e12 + (q < 3 ? 1 : 0) + (q == 3 ? splitAmount : 0);
            assertEq(market.questionState(2, q).activeCollateral, expected);
        }
        assertEq(market.pendingCarry(), SEED - capacity);
        vm.prank(ALICE);
        assertEq(market.mergePosition(2, 3, splitAmount), splitAmount);
        assertEq(market.questionState(2, 3).activeCollateral, 1e12);
        assertEq(market.totalActiveCollateral(), capacity);
        assertEq(market.pendingCarry(), SEED - capacity);
    }

    function test_receiverForwardingPreservesClaimsAndAllFinancialEntriesRemainLocked() public {
        IndependentAuditReceiver receiver = new IndependentAuditReceiver(market, token, BOB);
        token.mint(address(receiver), 19e18);
        receiver.buy();
        receiver.split();
        assertEq(receiver.blocked(), 18);
        assertEq(market.balanceOf(BOB, market.positionId(1, 0, true)), 15e18);
        assertEq(market.balanceOf(BOB, market.positionId(1, 1, true)), 9e18);
        assertEq(market.balanceOf(BOB, market.positionId(1, 1, false)), 9e18);
        _close(1, 1100, 1);
        _open(2, 1101);
        market.fundRound(2, 0);
        source.setUnavailable(1, true);
        vm.prank(BOB);
        assertEq(market.claimKnown(1), 24e18);
        assertEq(vault.totalEscrowed(), 0);
    }

    function test_tokenCallbacksCannotEnterFinanceDuringActiveOrVaultTransfers() public {
        vm.prank(ALICE);
        market.buy(1, 0, true, 10e18, 15e18, type(uint256).max);
        vm.prank(ALICE);
        market.splitPosition(1, 1, 9e18);
        uint256[8] memory amounts;
        amounts[1] = 1;
        bytes[9] memory attempts = [
            abi.encodeCall(market.fundRound, (1, 1)),
            abi.encodeCall(market.fundRound, (1, 0)),
            abi.encodeCall(market.buy, (1, 0, true, 1, 1, type(uint256).max)),
            abi.encodeCall(market.sell, (1, 0, true, 1, 1, type(uint256).max)),
            abi.encodeCall(market.splitPosition, (1, 0, 1)),
            abi.encodeCall(market.mergePosition, (1, 1, 1)),
            abi.encodeCall(market.mergePositions, (1, amounts)),
            abi.encodeCall(market.settleRound, (1)),
            abi.encodeCall(market.claimKnown, (1))
        ];
        // Origins 9-10 absorb held CST before pricing; 11-12 auto-start cycle 2, so
        // their first callback fires during settlement's escrow push to the vault.
        for (uint256 origin; origin < 13; ++origin) {
            for (uint256 target; target < attempts.length; ++target) {
                uint256 snapshot = vm.snapshotState();
                if ((origin >= 5 && origin <= 8) || origin >= 11) _close(1, 1100, 1);
                if (origin == 6 || origin == 7) market.settleRound(1);
                if (origin == 8 || origin >= 11) _open(2, 1101);
                if (origin == 9 || origin == 10) token.transfer(address(market), 2e18);
                if (origin == 12) {
                    vm.prank(ALICE);
                    market.splitPosition(2, 3, 2e18); // Positions in cycle 2 without starting it.
                }
                token.arm(address(market), attempts[target]);
                if (origin == 0) {
                    market.fundRound(1, 1);
                } else if (origin == 1) {
                    vm.prank(ALICE);
                    market.buy(1, 2, true, 1e18, 1e18, type(uint256).max);
                } else if (origin == 2) {
                    vm.prank(ALICE);
                    market.sell(1, 0, true, 1e18, 1e17, type(uint256).max);
                } else if (origin == 3) {
                    vm.prank(ALICE);
                    market.splitPosition(1, 2, 1e18);
                } else if (origin == 4 || origin == 7) {
                    vm.prank(ALICE);
                    market.mergePosition(1, 1, 1e18);
                } else if (origin == 5) {
                    market.settleRound(1);
                } else if (origin == 6) {
                    vm.prank(ALICE);
                    market.claimKnown(1);
                } else if (origin == 8) {
                    market.fundRound(2, 1e18); // Automatic escrow transfer followed by a new funding pull.
                } else if (origin == 9) {
                    vm.prank(ALICE);
                    market.buy(1, 2, true, 1e18, 1e18, type(uint256).max);
                } else if (origin == 10) {
                    vm.prank(ALICE);
                    market.sell(1, 0, true, 1e18, 1e17, type(uint256).max);
                } else if (origin == 11) {
                    vm.prank(ALICE);
                    market.buy(2, 2, true, 1e18, 1e18, type(uint256).max);
                } else {
                    vm.prank(ALICE);
                    market.sell(2, 3, true, 1e18, 1e17, type(uint256).max);
                }
                if (origin >= 11) {
                    assertEq(token.callbackCount(), 2, "no callback during the settlement push");
                    assertTrue(market.roundState(1).settled && market.roundState(2).funded);
                }
                assertGt(token.callbackCount(), 0);
                assertEq(token.callbackSuccesses(), 0);
                assertFalse(token.wrongCallbackRevert(), "failure was not the shared financial lock");
                assertEq(token.balanceOf(address(market)), market.totalActiveCollateral() + market.pendingCarry());
                assertEq(token.balanceOf(address(vault)), vault.totalEscrowed());
                assertTrue(vm.revertToState(snapshot));
            }
        }
    }

    function test_aSamePositionRoundTripCannotExtractCashWithoutAnExternalChange() public {
        vm.prank(ALICE);
        market.buy(1, 0, true, 10e18, 15e18, type(uint256).max);
        uint256 beforeWallet = token.balanceOf(ALICE);
        vm.prank(ALICE);
        vm.expectRevert(BinaryMarketMath.ProductWouldDecrease.selector);
        market.sell(1, 0, true, 15e18, 10e18 + 1, type(uint256).max);
        assertEq(token.balanceOf(ALICE), beforeWallet);
        assertEq(market.balanceOf(ALICE, market.positionId(1, 0, true)), 15e18);
    }

    function testFuzz_completePairsRedeemExactlyInLiveClosedOrEscrowedPhase(
        uint8 rawQuestion,
        uint128 rawAmount,
        uint8 phaseSeed
    ) public {
        uint8 q = rawQuestion % 8;
        uint256 amount = bound(rawAmount, 1, 1e24);
        uint256 beforeWallet = token.balanceOf(ALICE);
        vm.prank(ALICE);
        market.splitPosition(1, q, amount);
        uint8 phase = phaseSeed % 3;
        if (phase != 0) _close(1, 1100, 165);
        if (phase == 2) market.settleRound(1);
        source.setUnavailable(1, true);
        vm.prank(ALICE);
        assertEq(market.mergePosition(1, q, amount), amount);
        assertEq(token.balanceOf(ALICE), beforeWallet);
        assertEq(market.totalSupply(market.positionId(1, q, true)), 0);
        assertEq(market.totalSupply(market.positionId(1, q, false)), 0);
        assertEq(token.balanceOf(address(market)) + token.balanceOf(address(vault)), SEED);
        assertEq(vault.totalEscrowed(), 0);
    }

    function _close(uint256 id, uint256 end, uint8 values) private {
        (,,,, uint256 start,) = source.states(id);
        vm.warp(end);
        source.set(id, false, true, 255, values, start, end);
    }

    function _open(uint256 id, uint256 start) private {
        vm.warp(start);
        source.set(id, true, false, 0, 0, start, 0);
    }
}
