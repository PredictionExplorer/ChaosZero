// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {GestureSeriesMarket} from "../src/GestureSeriesMarket.sol";
import {ICosmicSignatureGame} from "../src/ICosmicSignatureGame.sol";
import {SeriesTestBase} from "./utils/SeriesTestBase.sol";
import {MockGame, ReenteringCst, FalseReturningCst, IReentryHook} from "./utils/Mocks.sol";

/// @notice Attacker that reenters `claim()` while the market is paying it out.
contract ClaimReenterer is IReentryHook {
    GestureSeriesMarket public immutable market;
    uint256 public immutable roundId;
    bool public reentryReverted;
    bool internal reentered;

    constructor(GestureSeriesMarket market_, uint256 roundId_) {
        market = market_;
        roundId = roundId_;
    }

    function claimOnce() external returns (uint256) {
        return market.claim(roundId);
    }

    function onCstReceived() external {
        if (reentered) return;
        reentered = true;
        try market.claim(roundId) {
            reentryReverted = false;
        } catch {
            reentryReverted = true;
        }
    }
}

/// @notice Attacker that reenters the market while receiving an LP fee payout,
/// trying to double-collect fees or double-remove liquidity.
contract LpReenterer is IReentryHook {
    GestureSeriesMarket public immutable market;
    uint256 public immutable roundId;
    bool public feeReentryReverted;
    bool public removeReentryReverted;
    bool internal reentered;

    constructor(GestureSeriesMarket market_, uint256 roundId_) {
        market = market_;
        roundId = roundId_;
    }

    function addLiquidity(uint256 amount) external {
        market.addLiquidity(roundId, amount, 200, 5_000, 0, type(uint256).max);
    }

    function claimFeesOnce() external returns (uint256) {
        return market.claimFees(roundId);
    }

    function onCstReceived() external {
        if (reentered) return;
        reentered = true;
        try market.claimFees(roundId) {
            feeReentryReverted = false;
        } catch {
            feeReentryReverted = true;
        }
        try market.removeLiquidity(roundId, 1, 0, 0, type(uint256).max) {
            removeReentryReverted = false;
        } catch {
            removeReentryReverted = true;
        }
    }
}

/// @notice Adversarial and hostile-environment tests. Each test scripts a
/// concrete attack someone might actually try and proves the mitigation holds.
contract GestureSeriesMarketHardeningTest is SeriesTestBase {
    // ------------------------------------------------------------------
    // Front-running: liquidity pulls, sandwiches, fee jacks
    // ------------------------------------------------------------------

    /// THE original attack from the design discussion: an LP watches the
    /// mempool, sees a bet coming, and pulls their liquidity first so the bet
    /// executes into a near-empty pool at a terrible price. The bettor's
    /// minTokensOut (computed off the pre-pull quote) must revert the trade.
    function test_attack_lpPullsLiquidityBeforeBet() public {
        uint256 adaShares = _seedPool(LIQ);

        // Victim quotes 1000 CST -> YES and signs with 1% slippage tolerance.
        uint256 quoted = market.quoteBetYes(ROUND, 1_000e18);
        uint256 minOut = quoted * 99 / 100;

        // LP front-runs: pulls 95% of the pool.
        vm.prank(lpAda);
        market.removeLiquidity(ROUND, adaShares * 95 / 100, 0, 0, NO_DEADLINE);

        // The victim's transaction lands after the pull — and safely reverts.
        vm.prank(alice);
        vm.expectRevert(GestureSeriesMarket.Slippage.selector);
        market.betYes(ROUND, 1_000e18, minOut, NO_DEADLINE);

        // Without the guard the fill would have been catastrophically worse.
        assertLt(market.quoteBetYes(ROUND, 1_000e18), minOut, "sanity: the pull really degraded the price");
    }

    /// The weighted-fee analogue: a whale deposits a huge stake declared at
    /// the 10% cap right before the victim's bet, jacking the average fee.
    /// The victim's minTokensOut floor reverts the degraded fill exactly like
    /// a liquidity pull.
    function test_attack_feeJackSandwichBoundedBySlippage() public {
        _seedPoolWith(lpAda, LIQ, 100, 5_000); // pool opens at a 1% fee
        assertEq(market.currentFeeBps(ROUND), 100);

        // Victim quotes at the 1% fee and signs with 0.5% tolerance.
        uint256 quoted = market.quoteBetYes(ROUND, 2_000e18);
        uint256 minOut = quoted * 995 / 1_000;

        // Whale front-runs: 9x the pool declared at the 10% cap -> fee ~9.1%.
        vm.prank(bob);
        market.addLiquidity(ROUND, LIQ * 9, 1_000, 0, 0, NO_DEADLINE);
        assertGt(market.currentFeeBps(ROUND), 800, "sanity: the fee really jumped");

        // The victim's bet lands after the jack — and safely reverts.
        vm.prank(alice);
        vm.expectRevert(GestureSeriesMarket.Slippage.selector);
        market.betYes(ROUND, 2_000e18, minOut, NO_DEADLINE);
    }

    /// A whale voting the maximum can never push the fee beyond the 10% cap,
    /// and quotes always reflect exactly what execution charges.
    function test_attack_feeVoteWhaleIsCapped() public {
        _seedPoolWith(lpAda, LIQ, 1_000, 5_000);
        vm.prank(bob);
        market.addLiquidity(ROUND, LIQ * 100, 1_000, 0, 0, NO_DEADLINE);

        assertEq(market.currentFeeBps(ROUND), 1_000, "everyone at the cap -> exactly the cap");
        uint256 quoted = market.quoteBetYes(ROUND, 1_000e18);
        vm.prank(alice);
        assertEq(market.betYes(ROUND, 1_000e18, quoted, NO_DEADLINE), quoted, "quote == execution at the cap");
    }

    /// Classic sandwich: attacker buys YES ahead of the victim, the victim's
    /// bet would execute at the inflated price. The slippage bound caps the
    /// victim's loss at exactly the tolerance they chose.
    function test_attack_sandwichBoundedBySlippage() public {
        _seedPool(LIQ);
        uint256 quoted = market.quoteBetYes(ROUND, 2_000e18);
        uint256 minOut = quoted * 995 / 1_000; // 0.5% tolerance

        // Attacker front-runs with a large YES buy.
        vm.prank(bob);
        market.betYes(ROUND, 5_000e18, 0, NO_DEADLINE);

        // Victim is protected: execution would be below the signed floor.
        vm.prank(alice);
        vm.expectRevert(GestureSeriesMarket.Slippage.selector);
        market.betYes(ROUND, 2_000e18, minOut, NO_DEADLINE);
    }

    /// Stale transactions can't be replayed later at manipulated prices:
    /// every price-sensitive function honors its deadline.
    function test_attack_staleTransactionsRejectedByDeadline() public {
        _seedPool(LIQ);
        // vm.getBlockTimestamp(), not block.timestamp: the via-IR optimizer
        // may reuse one block.timestamp read across the vm.warp below.
        uint256 deadline = vm.getBlockTimestamp() + 300;
        vm.warp(vm.getBlockTimestamp() + 301);

        vm.startPrank(alice);
        vm.expectRevert(GestureSeriesMarket.DeadlineExpired.selector);
        market.betYes(ROUND, 1e18, 0, deadline);
        vm.expectRevert(GestureSeriesMarket.DeadlineExpired.selector);
        market.betNo(ROUND, 1e18, 0, deadline);
        vm.stopPrank();
        vm.startPrank(lpBen);
        vm.expectRevert(GestureSeriesMarket.DeadlineExpired.selector);
        market.addLiquidity(ROUND, 1_000e18, FEE, 0, 0, deadline);
        vm.expectRevert(GestureSeriesMarket.DeadlineExpired.selector);
        market.removeLiquidity(ROUND, 1, 0, 0, deadline);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // JIT liquidity
    // ------------------------------------------------------------------

    /// Just-in-time liquidity: an LP jumps in right before a big bet and out
    /// right after, skimming fees from passive LPs. The bounds that hold by
    /// construction: the JIT LP inherits zero pre-join fees, skims at most a
    /// pro-rata slice of the one bet it sniped, cannot extract more CASH than
    /// deposit + fees, and dilutes the passive LP by exactly the share ratio.
    function test_attack_jitLiquidityCannotExtractBeyondProRataFees() public {
        _seedPool(LIQ);
        // Fees accrued BEFORE the JIT join belong to Ada alone.
        vm.prank(carol);
        market.betYes(ROUND, 4_000e18, 0, NO_DEADLINE);
        uint256 adaPreJitFees = _lpPending(ROUND, lpAda);

        uint256 jitCash = cst.balanceOf(lpBen);
        vm.prank(lpBen);
        uint256 jitShares = market.addLiquidity(ROUND, LIQ, FEE, 0, 0, NO_DEADLINE);
        assertEq(_lpPending(ROUND, lpBen), 0, "JIT LP must not inherit pre-join fees");

        // The big bet the JIT LP is sniping.
        uint256 feeNow = market.currentFeeBps(ROUND);
        vm.prank(alice);
        market.betYes(ROUND, 10_000e18, 0, NO_DEADLINE);
        uint256 betFee = 10_000e18 * feeNow / BPS;
        uint256 totalShares = _totalShares(ROUND);

        // JIT LP exits immediately.
        vm.prank(lpBen);
        (,, uint256 jitFees) = market.removeLiquidity(ROUND, jitShares, 0, 0, NO_DEADLINE);
        assertLe(jitFees, betFee * jitShares / totalShares + 1, "JIT LP skimmed beyond pro-rata");

        // The passive LP keeps her pre-join fees in full plus her exact
        // pro-rata cut of the sniped bet — diluted by shares, nothing worse.
        // (Tolerance: the accumulator floors twice per fee event.)
        (uint256 adaShares, uint256 adaPending,) = market.lpPositionOf(ROUND, lpAda);
        uint256 roundingSlack = 2 * (adaShares / 1e18 + 1);
        assertGe(
            adaPending + roundingSlack, adaPreJitFees + betFee * adaShares / totalShares, "passive LP over-diluted"
        );

        // Cash-extraction bound: after redeeming every pair, the JIT LP's
        // CST can never exceed deposit + fees; the rest of its exit is risky
        // one-sided inventory, not money.
        vm.startPrank(lpBen);
        (uint256 yes, uint256 no) = market.balancesOf(ROUND, lpBen);
        market.redeemSets(ROUND, yes < no ? yes : no);
        vm.stopPrank();
        assertLe(cst.balanceOf(lpBen), jitCash + jitFees, "JIT roundtrip extracted cash beyond fees");
    }

    // ------------------------------------------------------------------
    // First-depositor share inflation
    // ------------------------------------------------------------------

    /// The classic ERC4626/Uniswap-v2 inflation attack, adapted: attacker
    /// opens the pool with the minimum, pumps reserves-per-share with huge
    /// bets, and waits for a victim deposit hoping rounding swallows it.
    /// Dead shares + the minimum initial deposit + pool-favoring rounding
    /// bound the victim's loss to dust.
    function test_attack_shareInflationYieldsOnlyDust() public {
        address attacker = bob;
        address victim = lpBen;

        // Attacker opens the pool with the bare minimum...
        vm.prank(attacker);
        uint256 attackerShares = market.addLiquidity(ROUND, 1e15, FEE, 5_000, 0, NO_DEADLINE);
        // ...and pumps reserves-per-share with a massive bet.
        vm.prank(attacker);
        market.betYes(ROUND, 1_000_000e18, 0, NO_DEADLINE);

        uint256 attackerClaimBefore = _lpClaimValueCeiling(attacker);

        // Victim deposits normally.
        uint256 victimCash = cst.balanceOf(victim);
        vm.prank(victim);
        uint256 victimShares = market.addLiquidity(ROUND, 10_000e18, FEE, 0, 0, NO_DEADLINE);
        assertGt(victimShares, 0, "victim must always receive shares");

        // Victim exits immediately; their loss is rounding dust, not capital.
        vm.startPrank(victim);
        market.removeLiquidity(ROUND, victimShares, 0, 0, NO_DEADLINE);
        (uint256 yes, uint256 no) = market.balancesOf(ROUND, victim);
        market.redeemSets(ROUND, yes < no ? yes : no);
        vm.stopPrank();
        (uint256 yesLeft, uint256 noLeft) = market.balancesOf(ROUND, victim);
        // Value the leftover single-sided tokens at zero — the harshest
        // possible accounting for the victim — and the loss is still dust.
        uint256 harshLoss = victimCash - cst.balanceOf(victim) - (yesLeft < noLeft ? yesLeft : noLeft);
        assertLt(harshLoss, 1e13, "victim lost more than dust to the inflation attack");

        // And the attacker gained nothing from the victim's roundtrip.
        assertLe(
            _lpClaimValueCeiling(attacker), attackerClaimBefore + 1e13, "attacker profited from the victim's deposit"
        );
        assertGt(attackerShares, 0);
    }

    /// @dev Upper bound on an LP's instantly-claimable value: pro-rata
    /// reserves (valuing every token at its 1 CST ceiling) plus pending fees.
    function _lpClaimValueCeiling(address who) internal view returns (uint256) {
        (uint256 shares, uint256 pending,) = market.lpPositionOf(ROUND, who);
        (uint256 rY, uint256 rN, uint256 total,,,,) = market.pool(ROUND);
        if (total == 0) return pending;
        return pending + (rY * shares / total) + (rN * shares / total);
    }

    // ------------------------------------------------------------------
    // Donations
    // ------------------------------------------------------------------

    /// Reserves are internal accounting: direct CST transfers change no
    /// quote, no share value, no fee, no payout — the donation is stranded.
    function testFuzz_attack_directDonationIsInert(uint256 donation, bool yesWins) public {
        donation = bound(donation, 1, 1e24);
        _seedPool(LIQ);
        vm.prank(alice);
        market.betYes(ROUND, 2_000e18, 0, NO_DEADLINE);

        uint256 quoteBefore = market.quoteBetNo(ROUND, 500e18);
        (uint256 rYBefore, uint256 rNBefore) = _reserves(ROUND);
        uint256 feeBefore = market.currentFeeBps(ROUND);

        cst.mint(address(market), donation); // hostile/accidental donation

        (uint256 rY, uint256 rN) = _reserves(ROUND);
        assertEq(rY, rYBefore, "donation moved reserves");
        assertEq(rN, rNBefore);
        assertEq(market.currentFeeBps(ROUND), feeBefore, "donation moved the fee");
        assertEq(market.quoteBetNo(ROUND, 500e18), quoteBefore, "donation moved quotes");

        _endRoundWith(yesWins ? THRESHOLD + 1 : THRESHOLD);
        market.resolve(ROUND);

        (uint256 yes, uint256 no) = market.balancesOf(ROUND, alice);
        vm.prank(alice);
        assertEq(market.claim(ROUND), yesWins ? yes : no, "donation changed a payout");
        assertGe(cst.balanceOf(address(market)), donation, "someone extracted the donation");
    }

    // ------------------------------------------------------------------
    // Reentrancy
    // ------------------------------------------------------------------

    /// @dev Builds a series market whose CST notifies recipients mid-transfer,
    /// simulating an ERC-777-style callback token.
    function _deployReenteringMarket() internal returns (GestureSeriesMarket m, ReenteringCst evilCst) {
        evilCst = new ReenteringCst();
        MockGame evilGame = new MockGame(address(evilCst));
        evilGame.setRoundNum(ROUND);
        evilGame.setNumBids(ROUND - 1, THRESHOLD);
        m = new GestureSeriesMarket(ICosmicSignatureGame(address(evilGame)));
        game = evilGame; // so the base helpers keep working
    }

    function test_attack_claimReentrancyBlocked() public {
        (GestureSeriesMarket m, ReenteringCst evilCst) = _deployReenteringMarket();

        ClaimReenterer attacker = new ClaimReenterer(m, ROUND);
        evilCst.mint(address(this), LIQ);
        evilCst.approve(address(m), type(uint256).max);
        m.addLiquidity(ROUND, LIQ, FEE, 5_000, 0, NO_DEADLINE);

        evilCst.mint(address(attacker), 1_000e18);
        vm.startPrank(address(attacker));
        evilCst.approve(address(m), type(uint256).max);
        m.betYes(ROUND, 1_000e18, 0, NO_DEADLINE);
        vm.stopPrank();
        (uint256 entitled,) = m.balancesOf(ROUND, address(attacker));

        game.setNumBids(ROUND, THRESHOLD + 1);
        game.setRoundNum(ROUND + 1);
        m.resolve(ROUND);

        evilCst.setHook(address(attacker));
        uint256 firstPayout = attacker.claimOnce();

        assertEq(firstPayout, entitled, "legitimate claim must pay in full");
        assertTrue(attacker.reentryReverted(), "reentrant claim must revert (lock held)");
        assertEq(evilCst.balanceOf(address(attacker)), entitled, "attacker extracted extra CST");
    }

    function test_attack_lpFeeReentrancyBlocked() public {
        (GestureSeriesMarket m, ReenteringCst evilCst) = _deployReenteringMarket();

        LpReenterer attacker = new LpReenterer(m, ROUND);
        evilCst.mint(address(attacker), LIQ);
        vm.prank(address(attacker));
        evilCst.approve(address(m), type(uint256).max);
        attacker.addLiquidity(LIQ);

        // Generate fees for the attacker-LP.
        evilCst.mint(alice, 5_000e18);
        vm.startPrank(alice);
        evilCst.approve(address(m), type(uint256).max);
        m.betYes(ROUND, 5_000e18, 0, NO_DEADLINE);
        vm.stopPrank();

        evilCst.setHook(address(attacker));
        (, uint256 pending,) = m.lpPositionOf(ROUND, address(attacker));
        uint256 got = attacker.claimFeesOnce();

        assertEq(got, pending, "legitimate fee claim pays in full");
        assertTrue(attacker.feeReentryReverted(), "reentrant claimFees must revert");
        assertTrue(attacker.removeReentryReverted(), "reentrant removeLiquidity must revert");
        assertEq(evilCst.balanceOf(address(attacker)), pending, "fees double-collected");
    }

    // ------------------------------------------------------------------
    // Misbehaving tokens
    // ------------------------------------------------------------------

    /// A token returning false (instead of reverting) must surface as
    /// TransferFailed everywhere, never as silent success.
    function test_attack_falseReturningTokenRejectedEverywhere() public {
        FalseReturningCst badCst = new FalseReturningCst();
        MockGame badGame = new MockGame(address(badCst));
        badGame.setRoundNum(ROUND);
        badGame.setNumBids(ROUND - 1, THRESHOLD);
        GestureSeriesMarket m = new GestureSeriesMarket(ICosmicSignatureGame(address(badGame)));

        badCst.mint(alice, 100_000e18);
        vm.startPrank(alice);
        badCst.approve(address(m), type(uint256).max);

        badCst.setFailTransfers(true);
        vm.expectRevert(GestureSeriesMarket.TransferFailed.selector);
        m.addLiquidity(ROUND, LIQ, FEE, 5_000, 0, NO_DEADLINE);

        badCst.setFailTransfers(false);
        m.addLiquidity(ROUND, LIQ, FEE, 5_000, 0, NO_DEADLINE);
        m.mintSets(ROUND, 100e18);

        badCst.setFailTransfers(true);
        vm.expectRevert(GestureSeriesMarket.TransferFailed.selector);
        m.betYes(ROUND, 10e18, 0, NO_DEADLINE);
        vm.expectRevert(GestureSeriesMarket.TransferFailed.selector);
        m.redeemSets(ROUND, 100e18);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // Trading on known outcomes
    // ------------------------------------------------------------------

    /// Nobody can buy certainty at a discount: the atomic decided-outcome
    /// check blocks bets in the very same block the count crosses.
    function test_attack_cannotBuyDecidedOutcome() public {
        _seedPool(LIQ);

        // The pool still prices YES around 50% — a certain 2x if tradable.
        game.setNumBids(ROUND, THRESHOLD + 1);
        assertApproxEqAbs(_probBps(ROUND), 5_000, 100, "pool is stale-priced, tempting to pick off");

        vm.startPrank(alice);
        vm.expectRevert(GestureSeriesMarket.OutcomeDecided.selector);
        market.betYes(ROUND, 10_000e18, 0, NO_DEADLINE);
        vm.expectRevert(GestureSeriesMarket.OutcomeDecided.selector);
        market.betNo(ROUND, 10_000e18, 0, NO_DEADLINE);
        vm.stopPrank();

        // Minting sets on a decided round is value-neutral and stays allowed:
        // a set costs 1 CST and pays exactly 1 CST after resolution.
        vm.prank(alice);
        market.mintSets(ROUND, 100e18);
        market.resolve(ROUND);
        vm.prank(alice);
        assertEq(market.claim(ROUND), 100e18, "a set is worth exactly its cost");
    }

    /// Same protection at the round boundary: once the game advances, stale
    /// bets on the finished round revert — no betting on published results.
    function test_attack_cannotBetOnFinishedRound() public {
        _seedPool(LIQ);
        _endRoundWith(THRESHOLD + 999); // outcome public now

        vm.prank(alice);
        vm.expectRevert(GestureSeriesMarket.RoundNotActive.selector);
        market.betYes(ROUND, 1_000e18, 0, NO_DEADLINE);
    }

    /// Defense in depth. An opened pool can never lose its liquidity: the
    /// DEAD_SHARES locked at address(0) keep totalShares > 0 and both reserves
    /// >= 1 forever (invariant_openedPoolsNeverClose), and nobody can sign
    /// for address(0) — so the zero-liquidity guards in `_bet` and `_quote`
    /// are unreachable on-chain. Simulating that impossible exit with a prank
    /// proves the guards fail closed (a clean InsufficientLiquidity, zero
    /// quotes) instead of dividing by zero.
    function test_defense_sharelessPoolFailsClosed() public {
        uint256 adaShares = _seedPool(LIQ);
        vm.prank(carol);
        market.betYes(ROUND, 1_000e18, 0, NO_DEADLINE);
        vm.prank(lpAda);
        market.removeLiquidity(ROUND, adaShares, 0, 0, NO_DEADLINE);

        // The last real LP leaving still leaves a (dust) pool that trades.
        (uint256 rY, uint256 rN) = _reserves(ROUND);
        assertEq(_totalShares(ROUND), DEAD_SHARES);
        assertGt(rY, 0, "dead shares keep a YES reserve");
        assertGt(rN, 0, "dead shares keep a NO reserve");
        assertGt(market.quoteBetYes(ROUND, 1e18), 0, "the dust pool still quotes");

        // The impossible: the dead-share holder exits.
        vm.prank(address(0));
        market.removeLiquidity(ROUND, DEAD_SHARES, 0, 0, NO_DEADLINE);
        (rY, rN) = _reserves(ROUND);
        assertEq(_totalShares(ROUND) + rY + rN, 0, "sanity: the pool is empty");

        vm.startPrank(alice);
        vm.expectRevert(GestureSeriesMarket.InsufficientLiquidity.selector);
        market.betYes(ROUND, 1e18, 0, NO_DEADLINE);
        vm.expectRevert(GestureSeriesMarket.InsufficientLiquidity.selector);
        market.betNo(ROUND, 1e18, 0, NO_DEADLINE);
        vm.stopPrank();
        assertEq(market.quoteBetYes(ROUND, 1e18), 0, "an empty pool quotes 0");
        assertEq(market.quoteBetNo(ROUND, 1e18), 0, "an empty pool quotes 0");
        assertEq(market.currentFeeBps(ROUND), 0, "an empty pool charges no fee");
    }

    /// LP funds are never trapped by resolution timing games: exits work
    /// while decided-but-unresolved AND after resolution.
    function test_lpCanAlwaysExit() public {
        uint256 shares = _seedPool(LIQ);
        vm.prank(alice);
        market.betYes(ROUND, 1_000e18, 0, NO_DEADLINE);

        _crossThreshold(); // decided, not yet resolved
        vm.prank(lpAda);
        market.removeLiquidity(ROUND, shares / 3, 0, 0, NO_DEADLINE);

        market.resolve(ROUND); // resolved
        vm.prank(lpAda);
        market.removeLiquidity(ROUND, shares / 3, 0, 0, NO_DEADLINE);
        vm.prank(lpAda);
        market.claimFees(ROUND);

        game.setRoundNum(ROUND + 5); // long over
        uint256 rest = _lpShares(ROUND, lpAda);
        vm.prank(lpAda);
        market.removeLiquidity(ROUND, rest, 0, 0, NO_DEADLINE);
        vm.prank(lpAda);
        market.claim(ROUND);
    }

    // ------------------------------------------------------------------
    // Cross-round isolation & resolution griefing
    // ------------------------------------------------------------------

    /// Activity in one round can never bleed into another: pools, balances,
    /// fees and fee votes are fully keyed by round.
    function test_attack_roundsAreFullyIsolated() public {
        _seedPool(LIQ);
        vm.prank(alice);
        market.betYes(ROUND, 2_000e18, 0, NO_DEADLINE);
        (uint256 rYBefore, uint256 rNBefore) = _reserves(ROUND);

        _endRoundWith(THRESHOLD + 1);
        market.resolve(ROUND);

        // New round: fresh pool, fresh fee vote.
        game.setNumBids(ROUND, THRESHOLD + 500);
        vm.prank(lpBen);
        market.addLiquidity(ROUND + 1, LIQ / 2, 900, 2_500, 0, NO_DEADLINE);
        vm.prank(bob);
        market.betNo(ROUND + 1, 3_000e18, 0, NO_DEADLINE);

        (uint256 rY, uint256 rN) = _reserves(ROUND);
        assertEq(rY, rYBefore, "old round reserves touched by new round");
        assertEq(rN, rNBefore);
        assertEq(market.currentFeeBps(ROUND), FEE, "old round's fee vote touched");
        assertEq(market.currentFeeBps(ROUND + 1), 900, "new round's own fee vote");

        assertGt(_lpPending(ROUND, lpAda), 0, "old-round fees preserved");
        (, uint256 adaFeesNew,) = market.lpPositionOf(ROUND + 1, lpAda);
        assertEq(adaFeesNew, 0, "no phantom fees in the new round");

        // Old-round claims unaffected by new-round activity.
        (uint256 aliceYes,) = market.balancesOf(ROUND, alice);
        vm.prank(alice);
        assertEq(market.claim(ROUND), aliceYes);
    }

    /// Resolution is permissionless but not abusable: it moves no funds and
    /// double-resolution reverts, so griefers gain nothing by racing it.
    function test_attack_resolveGriefingIsHarmless() public {
        _seedPool(LIQ);
        vm.prank(alice);
        market.betYes(ROUND, 1_000e18, 0, NO_DEADLINE);
        _endRoundWith(THRESHOLD + 1);

        uint256 balBefore = cst.balanceOf(address(market));
        vm.prank(carol); // random stranger resolves
        market.resolve(ROUND);
        assertEq(cst.balanceOf(address(market)), balBefore, "resolve must move no funds");

        vm.prank(bob);
        vm.expectRevert(GestureSeriesMarket.AlreadyResolved.selector);
        market.resolve(ROUND);
    }

    // ------------------------------------------------------------------
    // The rug: LP pulls everything right after the victim's bet fills
    // ------------------------------------------------------------------

    /// The attack this design gets asked about most: the LP waits for a bet
    /// to land, then yanks 100% of the liquidity in the very next
    /// transaction. The victim's fill already beat their floor; the rug can
    /// touch neither their tokens, nor their collateral, nor their payout —
    /// and (this scenario: the victim's side wins) the rugger comes out
    /// strictly DOWN, holding the losing inventory.
    function test_attack_lpRugAfterBetCannotTouchBettorFunds() public {
        address rugger = bob;
        address victim = alice;
        uint256 ruggerStart = cst.balanceOf(rugger);

        vm.prank(rugger);
        uint256 ruggerShares = market.addLiquidity(ROUND, LIQ, FEE, 5_000, 0, NO_DEADLINE);

        // The victim quotes, signs a 1% floor, and fills fairly.
        uint256 quoted = market.quoteBetYes(ROUND, 2_000e18);
        vm.prank(victim);
        uint256 filled = market.betYes(ROUND, 2_000e18, quoted * 99 / 100, NO_DEADLINE);

        // THE RUG: everything out, immediately.
        vm.prank(rugger);
        (uint256 rugYes,, uint256 rugFees) = market.removeLiquidity(ROUND, ruggerShares, 0, 0, NO_DEADLINE);

        // 1. The victim's position is untouched...
        (uint256 victimYes,) = market.balancesOf(ROUND, victim);
        assertEq(victimYes, filled, "rug altered the victim's tokens");

        // 2. ...and still fully collateralized, to the wei: the contract
        // holds exactly 1 CST per outstanding set plus the fee escrow.
        {
            (uint256 rY, uint256 rN,,, uint256 feeReserve,,) = market.pool(ROUND);
            (, uint256 rugNoBal) = market.balancesOf(ROUND, rugger);
            uint256 yesSupply = rY + victimYes + rugYes;
            uint256 noSupply = rN + rugNoBal;
            assertEq(yesSupply, noSupply, "set supplies diverged");
            assertEq(cst.balanceOf(address(market)), yesSupply + feeReserve, "collateralization broken by the rug");
        }

        // 3. The fee skim is bounded to the one bet the rugger hosted.
        assertLe(rugFees, 2_000e18 * uint256(FEE) / BPS + 1, "rugger skimmed beyond the bet's fee");

        // 4. The victim's side wins: the claim pays 1:1 in full, rug or not.
        _crossThreshold();
        market.resolve(ROUND);
        vm.prank(victim);
        assertEq(market.claim(ROUND), filled, "victim's payout degraded by the rug");

        // 5. The rugger's full exit (winning tokens claimed, losers void)
        // leaves them strictly down: the rug bought no edge, it just locked
        // in the losing side of the victim's trade.
        vm.prank(rugger);
        market.claim(ROUND);
        assertLt(cst.balanceOf(rugger), ruggerStart, "rugging a winning bettor somehow paid");
    }

    /// After a full rug the bettor is NOT trapped: betting the opposite side
    /// works even against the leftover dust (a bet always returns at least
    /// its net input, because it mints sets), and pairs redeem 1:1 for CST.
    function test_attack_rugVictimCanStillExitEarly() public {
        vm.prank(bob);
        uint256 ruggerShares = market.addLiquidity(ROUND, LIQ, FEE, 5_000, 0, NO_DEADLINE);
        vm.prank(alice);
        uint256 filled = market.betYes(ROUND, 2_000e18, 0, NO_DEADLINE);
        vm.prank(bob);
        market.removeLiquidity(ROUND, ruggerShares, 0, 0, NO_DEADLINE);

        (uint256 rY, uint256 rN) = _reserves(ROUND);
        assertLt(rY + rN, 1e6, "sanity: the pool really is dust now");

        // Enough CST on NO to pair the whole YES position, fee included.
        uint256 feeNow = market.currentFeeBps(ROUND);
        uint256 spend = filled * BPS / (BPS - feeNow) + 1;
        vm.startPrank(alice);
        uint256 noOut = market.betNo(ROUND, spend, 0, NO_DEADLINE);
        assertGe(noOut, filled, "the mint component must cover the position");
        market.redeemSets(ROUND, filled);
        vm.stopPrank();

        (uint256 yesLeft,) = market.balancesOf(ROUND, alice);
        assertEq(yesLeft, 0, "victim fully exited the YES position pre-resolution");
    }

    /// The mempool-watching liquidity pull, replayed against a FUTURE
    /// round's pool: the mandatory floor protects bets identically in every
    /// phase.
    function test_attack_lpPullsLiquidityBeforeBetOnFutureRound() public {
        uint256 future = ROUND + 2;
        vm.prank(lpAda);
        uint256 adaShares = market.addLiquidity(future, LIQ, FEE, 5_000, 0, NO_DEADLINE);

        uint256 quoted = market.quoteBetYes(future, 1_000e18);
        uint256 minOut = quoted * 99 / 100;

        vm.prank(lpAda);
        market.removeLiquidity(future, adaShares * 95 / 100, 0, 0, NO_DEADLINE);

        vm.prank(alice);
        vm.expectRevert(GestureSeriesMarket.Slippage.selector);
        market.betYes(future, 1_000e18, minOut, NO_DEADLINE);
    }

    // ------------------------------------------------------------------
    // The threshold reveal
    // ------------------------------------------------------------------

    /// The reveal snipe: a future pool sits at 50/50 when the previous round
    /// ends with a huge count, making YES a long shot. The sniper's bet in
    /// the transition block already trades against the just-locked threshold
    /// (the sync is in-call), pays the pool's price and fee, and moves value
    /// only out of LP inventory — full collateralization is untouched.
    function test_attack_transitionBlockRevealSniping() public {
        uint256 future = ROUND + 1;
        vm.prank(lpAda);
        market.addLiquidity(future, LIQ, FEE, 5_000, 0, NO_DEADLINE);
        vm.prank(alice);
        uint256 aliceYes = market.betYes(future, 1_000e18, 0, NO_DEADLINE);

        // ROUND ends enormous: round `future` now needs > 50k gestures for
        // YES, but the pool still prices it near 50%.
        (, uint256 preRN) = _reserves(future);
        _endRoundWith(50_000);

        vm.expectEmit(true, false, false, true);
        emit GestureSeriesMarket.ThresholdLocked(future, 50_000);
        vm.prank(bob);
        uint256 snipedNo = market.betNo(future, 5_000e18, 0, NO_DEADLINE);

        // The sniper's edge is bounded by what the pool held: everything
        // beyond their own minted tokens came out of the NO reserve.
        uint256 net = 5_000e18 - 5_000e18 * uint256(FEE) / BPS;
        assertLe(snipedNo - net, preRN, "sniper extracted more than LP inventory");

        // Solvency is exact through the snipe.
        (uint256 rY, uint256 rN,,, uint256 feeReserve,,) = market.pool(future);
        assertEq(rY + aliceYes, rN + snipedNo, "set supplies diverged");
        assertEq(cst.balanceOf(address(market)), rY + aliceYes + feeReserve, "collateralization broken by the snipe");
    }

    /// Degenerate reveal: the previous round ends with ZERO gestures, so the
    /// very first gesture of the new round decides YES. Even when both land
    /// in the same block, the in-call sync + decided-check refuse the trade
    /// — there is no ordering of events that lets certainty be bought.
    function test_attack_thresholdZeroInstantDecisionSameBlock() public {
        uint256 future = ROUND + 1;
        vm.prank(lpAda);
        market.addLiquidity(future, LIQ, FEE, 5_000, 0, NO_DEADLINE);

        _endRoundWith(0); // previous round: zero gestures -> threshold 0
        game.setNumBids(future, 1); // first gesture lands in the same block

        vm.prank(alice);
        vm.expectRevert(GestureSeriesMarket.OutcomeDecided.selector);
        market.betYes(future, 1_000e18, 0, NO_DEADLINE);
        vm.prank(alice);
        vm.expectRevert(GestureSeriesMarket.OutcomeDecided.selector);
        market.betNo(future, 1_000e18, 0, NO_DEADLINE);
        vm.prank(lpBen);
        vm.expectRevert(GestureSeriesMarket.OutcomeDecided.selector);
        market.addLiquidity(future, 1_000e18, FEE, 0, 0, NO_DEADLINE);

        market.resolve(future); // early YES, instantly available
        assertTrue(_state(future).yesWon);
    }

    /// Betting on published results, future-round flavor: a round funded as
    /// FUTURE whose whole life passed untouched. Every funding path must
    /// refuse — the result is public — while resolution and claims work.
    function test_attack_cannotBetOnFutureRoundThatAlreadyPassed() public {
        uint256 future = ROUND + 1;
        vm.prank(lpAda);
        market.addLiquidity(future, LIQ, FEE, 5_000, 0, NO_DEADLINE);
        vm.prank(alice);
        market.betNo(future, 1_000e18, 0, NO_DEADLINE);

        // Both rounds fly by without the market being touched.
        _endRoundWith(800);
        game.setNumBids(future, 750); // 750 <= 800: NO wins, publicly
        game.setRoundNum(future + 1);

        vm.startPrank(bob);
        vm.expectRevert(GestureSeriesMarket.RoundNotActive.selector);
        market.betNo(future, 10_000e18, 0, NO_DEADLINE);
        vm.expectRevert(GestureSeriesMarket.RoundNotActive.selector);
        market.addLiquidity(future, 1_000e18, FEE, 0, 0, NO_DEADLINE);
        vm.expectRevert(GestureSeriesMarket.RoundNotActive.selector);
        market.mintSets(future, 1e18);
        vm.stopPrank();

        market.resolve(future);
        (, uint256 aliceNo) = market.balancesOf(future, alice);
        vm.prank(alice);
        assertEq(market.claim(future), aliceNo, "honest pre-round bet pays out");
    }

    // ------------------------------------------------------------------
    // Future-pool inflation & init front-running
    // ------------------------------------------------------------------

    /// The classic share-inflation attack aimed at a FUTURE pool — the new
    /// surface must be exactly as hardened as the current round's.
    function test_attack_shareInflationOnFuturePoolYieldsOnlyDust() public {
        uint256 future = ROUND + 2;
        address attacker = bob;
        address victim = lpBen;

        vm.prank(attacker);
        market.addLiquidity(future, 1e15, FEE, 5_000, 0, NO_DEADLINE);
        vm.prank(attacker);
        market.betYes(future, 1_000_000e18, 0, NO_DEADLINE);

        uint256 victimCash = cst.balanceOf(victim);
        vm.prank(victim);
        uint256 victimShares = market.addLiquidity(future, 10_000e18, FEE, 0, 0, NO_DEADLINE);
        assertGt(victimShares, 0, "victim must always receive shares");

        vm.startPrank(victim);
        market.removeLiquidity(future, victimShares, 0, 0, NO_DEADLINE);
        (uint256 yes, uint256 no) = market.balancesOf(future, victim);
        market.redeemSets(future, yes < no ? yes : no);
        vm.stopPrank();
        (uint256 yesLeft, uint256 noLeft) = market.balancesOf(future, victim);
        uint256 harshLoss = victimCash - cst.balanceOf(victim) - (yesLeft < noLeft ? yesLeft : noLeft);
        assertLt(harshLoss, 1e13, "victim lost more than dust to the future-pool inflation attack");
    }

    /// Squatting the opening price: an attacker front-runs the first LP with
    /// a dust deposit at an extreme probability, so the honest opener lands
    /// as a JOINER at the squatter's ratio. Joins credit all excess back and
    /// never move the price, so the joiner can leave immediately for at most
    /// rounding dust — squatting extracts nothing.
    function test_attack_initFrontRunSquattingExtractsNothing() public {
        vm.prank(bob);
        market.addLiquidity(ROUND, 1e15, 1_000, 9_900, 0, NO_DEADLINE);
        uint256 squatterValueBefore = _lpClaimValueCeiling(bob);

        // The honest LP's "open at 50%" transaction lands second: a join.
        uint256 adaCash = cst.balanceOf(lpAda);
        vm.prank(lpAda);
        uint256 shares = market.addLiquidity(ROUND, LIQ, FEE, 5_000, 0, NO_DEADLINE);

        // She disagrees with the squatted price and leaves immediately.
        vm.startPrank(lpAda);
        market.removeLiquidity(ROUND, shares, 0, 0, NO_DEADLINE);
        (uint256 yes, uint256 no) = market.balancesOf(ROUND, lpAda);
        market.redeemSets(ROUND, yes < no ? yes : no);
        vm.stopPrank();

        (uint256 yesLeft, uint256 noLeft) = market.balancesOf(ROUND, lpAda);
        uint256 harshLoss = adaCash - cst.balanceOf(lpAda) - (yesLeft < noLeft ? yesLeft : noLeft);
        assertLt(harshLoss, 1e13, "squat roundtrip cost the honest LP more than dust");
        assertLe(_lpClaimValueCeiling(bob), squatterValueBefore + 1e13, "squatter profited from the roundtrip");
    }
}
