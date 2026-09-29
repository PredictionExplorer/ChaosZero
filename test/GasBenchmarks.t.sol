// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {VmSafe} from "forge-std/Vm.sol";
import {GestureSeriesMarket} from "../src/GestureSeriesMarket.sol";
import {ICosmicSignatureGame} from "../src/ICosmicSignatureGame.sol";
import {SeriesTestBase} from "./utils/SeriesTestBase.sol";

/// @notice Gas benchmarks for every state-changing entry point, each measured
/// in a realistic state, committed to snapshots/GasBenchmarksTest.json so any
/// change in gas shows up in review as a diff.
///
///   forge test --match-contract GasBenchmarksTest                             # refresh the snapshot
///   FORGE_SNAPSHOT_CHECK=true forge test --match-contract GasBenchmarksTest   # fail if any value moved
///
/// What a value means: execution gas of the market call frame, captured with
/// `vm.snapshotGasLastFrame` — everything the contract itself spends (its CST
/// transfers and game reads included), excluding the 21,000 intrinsic cost,
/// calldata, and end-of-transaction refunds. CST is the lightweight MockCst,
/// so treat values as a regression signal for this contract, not as a quote
/// of what an Arbitrum transaction costs.
///
/// Isolation is pinned on for this contract (inline config below), whatever
/// the CLI flags or Foundry's default: each top-level call runs as its own
/// transaction, so the measured call starts with cold accounts and clean
/// storage exactly like a real transaction. Without it, the scaffolding calls
/// in the same test would warm every slot and the numbers would be 30-90%
/// too low. Values are deterministic (no fuzzing, fixed inputs), so they only
/// move when the compiled code does.
///
/// forge-config: default.isolate = true
/// forge-config: heavy.isolate = true
contract GasBenchmarksTest is SeriesTestBase {
    uint256 internal constant BET = 100e18;

    function setUp() public override {
        // Coverage runs instrumented, unoptimized bytecode: its gas numbers
        // are meaningless and must never overwrite the snapshot.
        vm.skip(vm.isContext(VmSafe.ForgeContext.Coverage), "gas benchmarks need the production build");
        super.setUp();
    }

    // ------------------------------------------------------------------
    // Deployment
    // ------------------------------------------------------------------

    function test_deploy() public {
        GestureSeriesMarket fresh = new GestureSeriesMarket(ICosmicSignatureGame(address(game)));
        vm.snapshotGasLastFrame("deploy");
        assertEq(address(fresh.game()), address(game));
    }

    // ------------------------------------------------------------------
    // Liquidity
    // ------------------------------------------------------------------

    /// First LP of the current round: initializes the market, locks the
    /// threshold from the game, opens the pool.
    function test_addLiquidity_openCurrentRound() public {
        vm.prank(lpAda);
        uint256 shares = market.addLiquidity(ROUND, LIQ, FEE, 5_000, 0, NO_DEADLINE);
        vm.snapshotGasLastFrame("addLiquidity_openCurrentRound");
        assertEq(shares, LIQ - DEAD_SHARES);
        assertTrue(_state(ROUND).thresholdKnown);
    }

    /// First LP of a future round: no threshold to lock yet.
    function test_addLiquidity_openFutureRound() public {
        vm.prank(lpAda);
        uint256 shares = market.addLiquidity(ROUND + 1, LIQ, FEE, 5_000, 0, NO_DEADLINE);
        vm.snapshotGasLastFrame("addLiquidity_openFutureRound");
        assertEq(shares, LIQ - DEAD_SHARES);
        assertFalse(_state(ROUND + 1).thresholdKnown);
    }

    /// A new LP joins a traded pool at its current ratio.
    function test_addLiquidity_joinAsNewLp() public {
        _openTradedMarket();
        vm.prank(alice);
        uint256 shares = market.addLiquidity(ROUND, LIQ, 500, 0, 0, NO_DEADLINE);
        vm.snapshotGasLastFrame("addLiquidity_joinAsNewLp");
        assertGt(shares, 0);
    }

    /// An existing LP tops up: accrued fees are settled in CST and the whole
    /// position is re-declared.
    function test_addLiquidity_topUpSettlingFees() public {
        _openTradedMarket();
        assertGt(_lpPending(ROUND, lpAda), 0);
        vm.prank(lpAda);
        uint256 shares = market.addLiquidity(ROUND, LIQ, 150, 0, 0, NO_DEADLINE);
        vm.snapshotGasLastFrame("addLiquidity_topUpSettlingFees");
        assertGt(shares, 0);
        assertEq(_lpPending(ROUND, lpAda), 0);
    }

    function test_removeLiquidity_partial() public {
        _openTradedMarket();
        uint256 half = _lpShares(ROUND, lpAda) / 2;
        vm.prank(lpAda);
        (,, uint256 fees) = market.removeLiquidity(ROUND, half, 0, 0, NO_DEADLINE);
        vm.snapshotGasLastFrame("removeLiquidity_partial");
        assertGt(fees, 0);
    }

    function test_removeLiquidity_fullExit() public {
        _openTradedMarket();
        uint256 all = _lpShares(ROUND, lpBen);
        vm.prank(lpBen);
        (,, uint256 fees) = market.removeLiquidity(ROUND, all, 0, 0, NO_DEADLINE);
        vm.snapshotGasLastFrame("removeLiquidity_fullExit");
        assertGt(fees, 0);
        assertEq(_lpShares(ROUND, lpBen), 0);
    }

    function test_updateFeeDeclaration() public {
        _openTradedMarket();
        vm.prank(lpAda);
        market.updateFeeDeclaration(ROUND, 400);
        vm.snapshotGasLastFrame("updateFeeDeclaration");
        assertEq(_lpDeclaration(ROUND, lpAda), 400);
    }

    function test_claimFees() public {
        _openTradedMarket();
        vm.prank(lpAda);
        uint256 fees = market.claimFees(ROUND);
        vm.snapshotGasLastFrame("claimFees");
        assertGt(fees, 0);
    }

    // ------------------------------------------------------------------
    // Betting
    // ------------------------------------------------------------------

    function test_betYes_newPosition() public {
        _openTradedMarket();
        vm.prank(alice);
        uint256 out = market.betYes(ROUND, BET, 0, NO_DEADLINE);
        vm.snapshotGasLastFrame("betYes_newPosition");
        assertGt(out, BET / 2);
    }

    function test_betYes_addToPosition() public {
        _openTradedMarket();
        vm.prank(alice);
        market.betYes(ROUND, BET, 0, NO_DEADLINE);
        vm.prank(alice);
        uint256 out = market.betYes(ROUND, BET, 0, NO_DEADLINE);
        vm.snapshotGasLastFrame("betYes_addToPosition");
        assertGt(out, BET / 2);
    }

    function test_betNo_newPosition() public {
        _openTradedMarket();
        vm.prank(alice);
        uint256 out = market.betNo(ROUND, BET, 0, NO_DEADLINE);
        vm.snapshotGasLastFrame("betNo_newPosition");
        assertGt(out, BET / 2);
    }

    function test_betNo_addToPosition() public {
        _openTradedMarket();
        vm.prank(alice);
        market.betNo(ROUND, BET, 0, NO_DEADLINE);
        vm.prank(alice);
        uint256 out = market.betNo(ROUND, BET, 0, NO_DEADLINE);
        vm.snapshotGasLastFrame("betNo_addToPosition");
        assertGt(out, BET / 2);
    }

    /// Future-round bets skip the threshold lock and the decided check.
    function test_betYes_futureRound() public {
        _seedRoundPool(ROUND + 1, lpAda, LIQ);
        vm.prank(carol);
        market.betNo(ROUND + 1, BET, 0, NO_DEADLINE);
        vm.prank(alice);
        uint256 out = market.betYes(ROUND + 1, BET, 0, NO_DEADLINE);
        vm.snapshotGasLastFrame("betYes_futureRound");
        assertGt(out, BET / 2);
    }

    // ------------------------------------------------------------------
    // Sets
    // ------------------------------------------------------------------

    function test_mintSets() public {
        _openTradedMarket();
        vm.prank(alice);
        market.mintSets(ROUND, BET);
        vm.snapshotGasLastFrame("mintSets");
        assertEq(_yesBal(alice), BET);
    }

    function test_redeemSets() public {
        _openTradedMarket();
        vm.prank(alice);
        market.mintSets(ROUND, BET);
        vm.prank(alice);
        market.redeemSets(ROUND, BET / 2);
        vm.snapshotGasLastFrame("redeemSets");
        assertEq(_noBal(alice), BET / 2);
    }

    // ------------------------------------------------------------------
    // Resolution and claims
    // ------------------------------------------------------------------

    /// The common case: the game moved on; the threshold was locked while
    /// the round was live.
    function test_resolve_afterRoundEnd() public {
        _openTradedMarket();
        _endRoundWith(THRESHOLD + 50);
        market.resolve(ROUND);
        vm.snapshotGasLastFrame("resolve_afterRoundEnd");
        assertTrue(_state(ROUND).resolved);
    }

    /// The live count crossed the threshold: YES is certain mid-round.
    function test_resolve_early() public {
        _openTradedMarket();
        _crossThreshold();
        market.resolve(ROUND);
        vm.snapshotGasLastFrame("resolve_early");
        assertTrue(_state(ROUND).yesWon);
    }

    /// A round funded while still in the future and never touched while
    /// current: resolution also locks its threshold.
    function test_resolve_lockingThreshold() public {
        _seedRoundPool(ROUND + 1, lpAda, LIQ);
        game.setNumBids(ROUND, THRESHOLD);
        game.setNumBids(ROUND + 1, THRESHOLD - 1);
        game.setRoundNum(ROUND + 2);
        market.resolve(ROUND + 1);
        vm.snapshotGasLastFrame("resolve_lockingThreshold");
        assertFalse(_state(ROUND + 1).yesWon);
    }

    function test_claim_winner() public {
        _openTradedMarket();
        vm.prank(alice);
        market.betYes(ROUND, BET, 0, NO_DEADLINE);
        _endRoundWith(THRESHOLD + 50);
        market.resolve(ROUND);
        vm.prank(alice);
        uint256 paid = market.claim(ROUND);
        vm.snapshotGasLastFrame("claim_winner");
        assertGt(paid, BET);
    }

    function test_claim_loser() public {
        _openTradedMarket();
        vm.prank(alice);
        market.betNo(ROUND, BET, 0, NO_DEADLINE);
        _endRoundWith(THRESHOLD + 50);
        market.resolve(ROUND);
        vm.prank(alice);
        uint256 paid = market.claim(ROUND);
        vm.snapshotGasLastFrame("claim_loser");
        assertEq(paid, 0);
    }

    // ------------------------------------------------------------------
    // Scaffolding
    // ------------------------------------------------------------------

    /// @dev The current round as it looks in production: two LPs with
    /// different fee votes and trading on both sides, so every fee and
    /// reserve slot is already nonzero and no measured call pays the one-off
    /// zero-to-nonzero storage cost of a pool's very first trade.
    function _openTradedMarket() internal {
        _seedPool(LIQ);
        vm.prank(lpBen);
        market.addLiquidity(ROUND, LIQ / 2, 300, 0, 0, NO_DEADLINE);
        vm.prank(carol);
        market.betYes(ROUND, 5 * BET, 0, NO_DEADLINE);
        vm.prank(carol);
        market.betNo(ROUND, 3 * BET, 0, NO_DEADLINE);
    }
}
