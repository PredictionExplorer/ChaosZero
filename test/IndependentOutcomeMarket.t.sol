// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {IndependentOutcomeMarket, IIndependentCollateral} from "../src/IndependentOutcomeMarket.sol";
import {IIndependentOutcomeSource} from "../src/interfaces/IIndependentOutcomeSource.sol";
import {OutcomeSettlementVault} from "../src/OutcomeSettlementVault.sol";
import {MockCst} from "./utils/Mocks.sol";

contract IndependentUnitSource is IIndependentOutcomeSource {
    struct State {
        bool open;
        bool finalized;
        uint8 known;
        uint8 values;
        uint256 start;
        uint256 end;
    }
    mapping(uint256 => State) private states;
    mapping(uint256 => bool) public offline;
    error SourceOffline();

    function set(uint256 id, bool open, bool finalized, uint8 known, uint8 values, uint256 start, uint256 end)
        external
    {
        states[id] = State(open, finalized, known, values, start, end);
    }

    function setOffline(uint256 id, bool value) external {
        offline[id] = value;
    }

    function outcomeState(uint256 id) external view returns (bool, bool, uint8, uint8) {
        if (offline[id]) revert SourceOffline();
        State memory s = states[id];
        return (s.open, s.finalized, s.known, s.values);
    }

    function cycleTimes(uint256 id) external view returns (uint256, uint256) {
        if (offline[id]) revert SourceOffline();
        return (states[id].start, states[id].end);
    }
}

contract IndependentUnitTaxToken is MockCst {
    bool public tax;

    function setTax(bool value) external {
        tax = value;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        super.transfer(to, amount);
        if (tax) --balanceOf[to];
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        super.transferFrom(from, to, amount);
        if (tax) --balanceOf[to];
        return true;
    }
}

contract IndependentOutcomeMarketTest is Test, ERC1155Holder {
    IndependentOutcomeMarket private market;
    IndependentUnitSource private source;
    MockCst private token;
    address private constant ALICE = address(101);
    address private constant BOB = address(102);
    uint256 private constant SEED = 8000e18;

    function setUp() public {
        vm.warp(100);
        token = new MockCst();
        source = new IndependentUnitSource();
        source.set(0, false, true, 255, 0, 0, 100);
        source.set(1, true, false, 0, 0, 100, 0);
        market = new IndependentOutcomeMarket(IIndependentCollateral(address(token)), source);
        token.mint(address(this), 1e40);
        token.mint(ALICE, 1e40);
        token.approve(address(market), type(uint256).max);
        vm.prank(ALICE);
        token.approve(address(market), type(uint256).max);
    }

    function _buy(uint256 round, uint8 q, bool yes, uint256 cash, uint256 units) private {
        vm.prank(ALICE);
        market.buy(round, q, yes, cash, units, type(uint256).max);
    }

    function _split(uint256 round, uint8 q, uint256 amount) private {
        vm.prank(ALICE);
        market.splitPosition(round, q, amount);
    }

    function _close(uint256 id, uint8 values, uint256 start, uint256 end) private {
        vm.warp(end);
        source.set(id, false, true, 255, values, start, end);
    }

    function _open(uint256 id, uint256 start) private {
        source.set(id, true, false, 0, 0, start, 0);
    }

    function test_oneFundingTransactionAllocatesEightBudgetsWithExactRemainder() public {
        market.fundRound(1, SEED + 5);
        for (uint8 q; q < 8; ++q) {
            IndependentOutcomeMarket.QuestionView memory p = market.questionState(1, q);
            assertEq(p.activeCollateral, 1000e18 + (q < 5 ? 1 : 0));
            assertEq(p.initialYesBps, 5000);
            assertEq(p.currentYesBps, 5000);
            assertFalse(p.seedUsedHistory);
            assertEq(p.checkpointCount, 1);
        }
        assertEq(market.totalActiveCollateral(), SEED + 5);
        assertEq(token.balanceOf(address(market)), SEED + 5);
        assertEq(market.pendingCarry(), 0);
    }

    function test_knownAnswersTradeUntilClosureWithoutConsumingOtherBudgets() public {
        market.fundRound(1, SEED);
        IndependentOutcomeMarket.QuestionView memory beforeOther = market.questionState(1, 1);
        source.set(1, true, false, 1, 1, 100, 0);
        _buy(1, 0, true, 9000e18, 9900e18 - 1e8);
        _split(1, 0, 1e18);
        IndependentOutcomeMarket.QuestionView memory afterOther = market.questionState(1, 1);
        assertEq(keccak256(abi.encode(beforeOther)), keccak256(abi.encode(afterOther)));
        assertEq(market.roundState(1).knownMask, 1);
        vm.prank(ALICE);
        vm.expectRevert(IndependentOutcomeMarket.NotFinalized.selector);
        market.claimKnown(1);
        (bool claimable, uint256 total,) = market.previewClaim(1, ALICE);
        assertFalse(claimable);
        assertEq(total, 0);
        _buy(1, 1, true, 100e18, 190e18);
        _close(1, 3, 100, 200);
        vm.expectRevert(IndependentOutcomeMarket.RoundNotOpen.selector);
        _buy(1, 2, true, 1e18, 1e18);
    }

    function test_closureSeparatesWinningClaimsAndAllRemainingCapital() public {
        market.fundRound(1, SEED);
        _buy(1, 0, true, 100e18, 150e18);
        _split(1, 1, 7e18);
        _close(1, 1, 100, 200);
        (uint256 escrowed, uint256 carried) = market.settleRound(1);
        assertEq(escrowed, 157e18);
        assertEq(carried, 7950e18);
        assertEq(market.totalActiveCollateral(), 0);
        assertEq(market.pendingCarry(), carried);
        assertEq(market.settlementVault().remaining(1, 0), 150e18);
        assertEq(market.settlementVault().remaining(1, 1), 7e18);
        for (uint8 q; q < 8; ++q) {
            assertEq(market.questionState(1, q).activeCollateral, 0);
        }
        assertEq(token.balanceOf(address(market)), carried);
        assertEq(token.balanceOf(address(market.settlementVault())), escrowed);
        source.setOffline(1, true);
        (escrowed, carried) = market.settleRound(1);
        assertEq(escrowed, 0);
        assertEq(carried, 0);
        vm.prank(ALICE);
        assertEq(market.claimKnown(1), 157e18);
        vm.prank(ALICE);
        assertEq(market.claimKnown(1), 0);
        assertEq(market.pendingCarry(), 7950e18);
    }

    function test_firstNextFundingSettlesPriorAndPreservesUnclaimedTransferredWinner() public {
        market.fundRound(1, SEED);
        _buy(1, 0, true, 100e18, 150e18);
        _close(1, 1, 100, 200);
        _open(2, 200);
        IndependentOutcomeMarket.FundingPreview memory preview = market.fundingPreview(2, 50e18);
        assertTrue(preview.canFund);
        assertTrue(preview.needsSettlement);
        assertEq(preview.availableCarry, 7950e18);
        assertEq(preview.carryUsed, 7950e18);
        assertEq(preview.totalFunding, SEED);
        market.fundRound(2, 50e18);
        assertTrue(market.roundState(1).settled);
        assertEq(market.pendingCarry(), 0);
        assertEq(market.totalActiveCollateral(), SEED);
        source.setOffline(1, true);
        uint256 id = market.positionId(1, 0, true);
        vm.prank(ALICE);
        market.safeTransferFrom(ALICE, BOB, id, 150e18, "old winner");
        (bool claimable, uint256 total,) = market.previewClaim(1, BOB);
        assertTrue(claimable);
        assertEq(total, 150e18);
        vm.prank(BOB);
        assertEq(market.claimKnown(1), 150e18);
        assertEq(market.totalActiveCollateral(), SEED);
        assertEq(market.settlementVault().totalEscrowed(), 0);
    }

    function test_carryOnlyFundingAndWinningPayoutsStayExactlyOneToOne() public {
        market.fundRound(1, SEED);
        _split(1, 7, 1);
        _close(1, 128, 100, 200);
        _open(2, 200);
        market.fundRound(2, 0);
        assertEq(market.totalActiveCollateral(), SEED);
        assertEq(market.pendingCarry(), 0);
        vm.prank(ALICE);
        assertEq(market.claimKnown(1), 1); // A tiny complete pair cannot claim the seed.
        assertEq(market.totalActiveCollateral(), SEED);
    }

    function test_unfundedCyclesCanBeSkippedWithoutLosingSplitOnlyBacking() public {
        market.fundRound(1, SEED);
        _close(1, 0, 100, 200);
        _open(2, 200);
        _split(2, 3, 10e18);
        _close(2, 8, 200, 300);
        _open(5, 400);
        market.fundRound(5, 0); // Settles last funded1, not merely literal predecessor4.
        assertTrue(market.roundState(1).settled);
        assertFalse(market.roundState(2).settled);
        assertEq(market.totalActiveCollateral(), SEED + 10e18);
        (uint256 owed, uint256 carried) = market.settleRound(2);
        assertEq(owed, 10e18);
        assertEq(carried, 0);
        assertEq(market.pendingCarry(), 0);
        assertEq(market.totalActiveCollateral(), SEED);
        vm.prank(ALICE);
        assertEq(market.claimKnown(2), 10e18);
    }

    function test_mergesUseCorrectCustodyBeforeAndAfterSettlementWithoutSourceCalls() public {
        market.fundRound(1, SEED);
        _split(1, 0, 10e18);
        source.setOffline(1, true);
        vm.prank(ALICE);
        assertEq(market.mergePosition(1, 0, 3e18), 3e18);
        source.setOffline(1, false);
        _close(1, 1, 100, 200);
        market.settleRound(1);
        source.setOffline(1, true);
        vm.prank(ALICE);
        assertEq(market.mergePosition(1, 0, 7e18), 7e18);
        assertEq(market.pendingCarry(), SEED);
        assertEq(market.settlementVault().remaining(1, 0), 0);
        assertEq(market.totalActiveCollateral(), 0);
    }

    function test_middleWindowSeedIsExactAndIndependentOfLateSettlement() public {
        market.fundRound(1, SEED);
        vm.warp(140);
        _buy(1, 0, true, 100e18, 150e18);
        uint16 firstPrice = market.questionState(1, 0).currentYesBps;
        vm.warp(150);
        _buy(1, 0, true, 100e18, 150e18);
        uint16 secondPrice = market.questionState(1, 0).currentYesBps;
        _close(1, 1, 100, 200);
        _open(2, 200);
        vm.warp(1000);
        (uint16[8] memory prices, bool[8] memory used) = market.seedPreview(2);
        assertEq(prices[0], (uint256(firstPrice) + secondPrice) / 2);
        assertTrue(used[0]);
        market.fundRound(2, 100e18);
        assertEq(market.questionState(2, 0).initialYesBps, prices[0]);
        vm.warp(1100);
        market.fundRound(2, SEED);
        assertEq(market.questionState(2, 0).initialYesBps, prices[0]);
        assertEq(market.roundState(1).finalizedAt, 200);
    }

    function test_missingMiddleHistoryUsesStoredSeedAndDoesNotInventEarlierPrices() public {
        vm.warp(170);
        market.fundRound(1, SEED);
        _buy(1, 0, true, 100e18, 150e18);
        _close(1, 1, 100, 200);
        _open(2, 200);
        (uint16[8] memory prices, bool[8] memory used) = market.seedPreview(2);
        assertEq(prices[0], 5000);
        assertFalse(used[0]);
        _split(2, 1, 1e18); // Neutral positions can initialize but never sponsor pools.
        assertFalse(market.roundState(2).funded);
        market.fundRound(2, 50e18);
        assertEq(market.questionState(2, 0).initialYesBps, 5000);
        assertFalse(market.questionState(2, 0).seedUsedHistory);
    }

    function test_neutralOperationsDoNotWritePriceHistory() public {
        market.fundRound(1, SEED);
        vm.warp(120);
        _split(1, 0, 10e18);
        uint256 id = market.positionId(1, 0, true);
        vm.prank(ALICE);
        market.safeTransferFrom(ALICE, BOB, id, 1e18, "neutral transfer");
        vm.prank(ALICE);
        market.mergePosition(1, 0, 9e18);
        assertEq(market.historyLength(1, 0), 1);
        _buy(1, 1, true, 1e18, 1e18);
        assertEq(market.historyLength(1, 0), 1);
        assertEq(market.historyLength(1, 1), 2);
    }

    function test_initialCarryCapPreservesHeadroomAndDefersExcessAcrossCycles() public {
        uint256 max = market.MAX_COLLATERAL();
        market.fundRound(1, 4 * max);
        market.fundRound(1, 4 * max); // Explicit voluntary gifts may fill the documented cap.
        _close(1, 0, 100, 200);
        _open(2, 200);
        IndependentOutcomeMarket.FundingPreview memory p = market.fundingPreview(2, 0);
        assertEq(p.availableCarry, 8 * max);
        assertEq(p.carryUsed, 4 * max);
        assertEq(p.deferredCarry, 4 * max);
        assertEq(p.maxNewAmount, 0);
        vm.expectRevert(IndependentOutcomeMarket.FundingCapacity.selector);
        market.fundRound(2, 1);
        market.fundRound(2, 0);
        assertEq(market.pendingCarry(), 4 * max);
        for (uint8 q; q < 8; ++q) {
            assertEq(market.questionState(2, q).activeCollateral, max / 2);
        }
        market.fundRound(2, 8);
        assertEq(market.pendingCarry(), 4 * max); // Existing pools never consume deferred carry.
        _buy(2, 0, true, 1e18, 1e18);
        _close(2, 0, 200, 300);
        _open(3, 300);
        market.fundRound(3, 0);
        assertGt(market.pendingCarry(), 4 * max);
        assertEq(market.totalActiveCollateral(), 4 * max);
    }

    function test_capacityRemainderFormulaForEveryMinimumHeadroomIndex() public {
        uint256 max = market.MAX_COLLATERAL();
        uint256 room = 2e12;
        for (uint8 q; q < 8; ++q) {
            uint256 snap = vm.snapshotState();
            _split(1, q, max - room);
            uint256 capacity = 8 * room + q;
            IndependentOutcomeMarket.FundingPreview memory p = market.fundingPreview(1, capacity);
            assertEq(p.maxNewAmount, capacity);
            assertTrue(p.canFund);
            vm.expectRevert(IndependentOutcomeMarket.FundingCapacity.selector);
            market.fundRound(1, capacity + 1);
            market.fundRound(1, capacity);
            assertEq(market.questionState(1, q).activeCollateral, max);
            assertTrue(vm.revertToStateAndDelete(snap));
        }
    }

    function test_untrackedTransfersJoinTheNextAbsorptionAndThenRollOver() public {
        token.transfer(address(market), 100e18);
        market.fundRound(1, SEED);
        assertEq(market.totalActiveCollateral(), SEED + 100e18);
        _close(1, 0, 100, 200);
        market.settleRound(1);
        assertEq(market.pendingCarry(), SEED + 100e18);
        assertEq(token.balanceOf(address(market)), SEED + 100e18);
        _open(2, 200);
        market.fundRound(2, 0);
        assertEq(market.totalActiveCollateral(), SEED + 100e18);
        assertEq(token.balanceOf(address(market)), SEED + 100e18);
    }

    function test_invalidTimestampsAndContradictoryKnownAnswersRevertAtomically() public {
        market.fundRound(1, SEED);
        source.set(1, true, false, 1, 1, 100, 0);
        _buy(1, 0, true, 1e18, 1e18);
        source.set(1, true, false, 1, 0, 100, 0);
        vm.expectRevert(IndependentOutcomeMarket.InvalidSourceState.selector);
        _buy(1, 0, true, 1e18, 1e18);
        source.set(1, false, true, 255, 1, 100, 200);
        vm.expectRevert(IndependentOutcomeMarket.InvalidTimestamp.selector); // Future close.
        market.settleRound(1);
        source.set(1, false, true, 255, 1, 100, 99);
        vm.expectRevert(IndependentOutcomeMarket.InvalidTimestamp.selector);
        market.settleRound(1);
        assertFalse(market.roundState(1).settled);
        assertEq(market.pendingCarry(), 0);
        assertEq(market.totalActiveCollateral(), SEED + 1e18);
    }

    function test_settlementTransferFailureRestoresAllQuestionLedgers() public {
        IndependentUnitTaxToken taxed = new IndependentUnitTaxToken();
        IndependentOutcomeMarket m = new IndependentOutcomeMarket(IIndependentCollateral(address(taxed)), source);
        taxed.mint(address(this), SEED + 10e18);
        taxed.approve(address(m), type(uint256).max);
        m.fundRound(1, SEED);
        m.splitPosition(1, 0, 10e18);
        _close(1, 0, 100, 200);
        taxed.setTax(true);
        vm.expectRevert(IndependentOutcomeMarket.TransferFailed.selector);
        m.settleRound(1);
        assertFalse(m.roundState(1).settled);
        assertFalse(m.settlementVault().registered(1));
        assertEq(m.pendingCarry(), 0);
        assertEq(m.totalActiveCollateral(), SEED + 10e18);
        assertEq(m.questionState(1, 0).activeCollateral, 1010e18);
        assertEq(taxed.balanceOf(address(m)), SEED + 10e18);
        taxed.setTax(false);
        m.settleRound(1);
        assertEq(m.claimKnown(1), 10e18);
    }

    function test_roundIdentifierBoundsAndUnfundedTradeChecks() public {
        uint256 maximum = market.MAX_ROUND_ID();
        vm.expectRevert(IndependentOutcomeMarket.InvalidParameters.selector);
        market.fundRound(maximum + 1, SEED);
        vm.expectRevert(IndependentOutcomeMarket.InvalidParameters.selector);
        market.splitPosition(maximum + 1, 0, 1);
        vm.expectRevert(IndependentOutcomeMarket.NotFunded.selector);
        _buy(1, 0, true, 1e18, 1e18);
        assertEq(market.totalActiveCollateral(), 0);
        assertEq(market.positionId(maximum, 7, true), type(uint256).max);
    }

    function test_binaryTradeGasIsBelowOneMillion() public {
        market.fundRound(1, SEED);
        vm.cool(address(market));
        vm.cool(address(token));
        vm.cool(address(source));
        vm.prank(ALICE);
        uint256 beforeGas = gasleft();
        market.buy(1, 0, true, 100e18, 150e18, type(uint256).max);
        uint256 used = beforeGas - gasleft();
        emit log_named_uint("independent weighted binary buy gas", used);
        assertLt(used, 1_000_000);
    }
}
