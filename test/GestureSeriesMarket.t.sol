// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {GestureSeriesMarket} from "../src/GestureSeriesMarket.sol";
import {ICosmicSignatureGame} from "../src/ICosmicSignatureGame.sol";
import {SeriesTestBase} from "./utils/SeriesTestBase.sol";
import {MockGame} from "./utils/Mocks.sol";

/// @notice Core unit tests: happy paths, guards, and known edge cases for
/// every external function of the series market.
contract GestureSeriesMarketTest is SeriesTestBase {
    // ------------------------------------------------------------------
    // Construction
    // ------------------------------------------------------------------

    function test_constructorState() public view {
        assertEq(address(market.game()), address(game));
        assertEq(address(market.cst()), address(cst));
    }

    function test_constructorRejectsZeroGame() public {
        vm.expectRevert(GestureSeriesMarket.InvalidParams.selector);
        new GestureSeriesMarket(ICosmicSignatureGame(address(0)));
    }

    /// CST is read from the game at construction; a game that reports no
    /// token must not produce a market bound to address(0).
    function test_constructorRejectsGameWithoutToken() public {
        MockGame tokenless = new MockGame(address(0));
        vm.expectRevert(GestureSeriesMarket.InvalidParams.selector);
        new GestureSeriesMarket(ICosmicSignatureGame(address(tokenless)));
    }

    // ------------------------------------------------------------------
    // Round initialization (lazy, via addLiquidity)
    // ------------------------------------------------------------------

    function test_firstAddLiquidityInitializesRound() public {
        vm.expectEmit(true, false, false, true);
        emit GestureSeriesMarket.RoundInitialized(ROUND);
        vm.expectEmit(true, false, false, true);
        emit GestureSeriesMarket.ThresholdLocked(ROUND, THRESHOLD);
        _seedPool(LIQ);

        RoundView memory v = _state(ROUND);
        assertTrue(v.initialized);
        assertTrue(v.roundActive);
        assertFalse(v.outcomeDecided);
        assertTrue(v.thresholdKnown, "current-round init locks the threshold immediately");
        assertEq(v.threshold, THRESHOLD, "threshold is the previous round's final count");
    }

    function test_cannotInitializePastRound() public {
        vm.prank(lpAda);
        vm.expectRevert(GestureSeriesMarket.RoundNotActive.selector);
        market.addLiquidity(ROUND - 1, LIQ, FEE, 5_000, 0, NO_DEADLINE);

        // Even a round that WAS fundable becomes closed to adds once the game
        // passes it: initialize now, then try to add after it ends.
        _seedPool(LIQ);
        _endRoundWith(700);
        vm.prank(lpBen);
        vm.expectRevert(GestureSeriesMarket.RoundNotActive.selector);
        market.addLiquidity(ROUND, 1_000e18, FEE, 0, 0, NO_DEADLINE);
    }

    function test_cannotInitializeRoundZero() public {
        // While the game is IN round 0 (round 0 has no previous round)...
        game.setRoundNum(0);
        vm.prank(lpAda);
        vm.expectRevert(GestureSeriesMarket.RoundNotActive.selector);
        market.addLiquidity(0, LIQ, FEE, 5_000, 0, NO_DEADLINE);
        // ...and forever after (round 0 is then simply a past round).
        game.setRoundNum(ROUND);
        vm.prank(lpAda);
        vm.expectRevert(GestureSeriesMarket.RoundNotActive.selector);
        market.addLiquidity(0, LIQ, FEE, 5_000, 0, NO_DEADLINE);
    }

    function test_cannotInitializeRoundWhoseOutcomeIsAlreadyDecided() public {
        _crossThreshold(); // count > threshold before anyone funded the market
        vm.prank(lpAda);
        vm.expectRevert(GestureSeriesMarket.OutcomeDecided.selector);
        market.addLiquidity(ROUND, LIQ, FEE, 5_000, 0, NO_DEADLINE);

        assertFalse(_state(ROUND).initialized, "failed init must roll back entirely");
    }

    // ------------------------------------------------------------------
    // addLiquidity: opening the pool
    // ------------------------------------------------------------------

    function test_openPoolAtEvenOdds() public {
        uint256 shares = _seedPool(LIQ);

        (uint256 rY, uint256 rN) = _reserves(ROUND);
        assertEq(rY, LIQ);
        assertEq(rN, LIQ);
        assertEq(shares, LIQ - DEAD_SHARES, "dead shares deducted from the first LP");
        assertEq(_totalShares(ROUND), LIQ);
        assertEq(_lpShares(ROUND, address(0)), DEAD_SHARES, "dead shares locked at address(0)");
        assertEq(_yesBal(lpAda), 0, "no excess tokens at 50/50");
        assertEq(_noBal(lpAda), 0);
        assertEq(_probBps(ROUND), 5_000);
    }

    function test_openPoolSetsTheFeeToTheOpenersDeclaration() public {
        _seedPoolWith(lpAda, LIQ, 350, 5_000);
        assertEq(market.currentFeeBps(ROUND), 350, "sole voter sets the average");
        assertEq(_feeWeight(ROUND), LIQ * 350, "dead shares carry the opener's declaration");
        assertEq(_lpDeclaration(ROUND, lpAda), 350);
    }

    function test_openPoolAtSkewedOddsCreditsExcess() public {
        // 30% YES: full deposit on the YES reserve, scaled NO reserve, excess NO back.
        _seedPoolWith(lpAda, LIQ, FEE, 3_000);

        (uint256 rY, uint256 rN) = _reserves(ROUND);
        assertEq(rY, LIQ);
        assertEq(rN, LIQ * 3_000 / 7_000);
        assertEq(_yesBal(lpAda), 0);
        assertEq(_noBal(lpAda), LIQ - rN, "surplus NO stays with the LP");
        assertApproxEqAbs(_probBps(ROUND), 3_000, 1);
    }

    function test_openPoolGuards() public {
        vm.startPrank(lpAda);
        // Below the minimum initial liquidity.
        vm.expectRevert(GestureSeriesMarket.InsufficientLiquidity.selector);
        market.addLiquidity(ROUND, 1e15 - 1, FEE, 5_000, 0, NO_DEADLINE);
        // Probability outside [1%, 99%].
        vm.expectRevert(GestureSeriesMarket.InvalidParams.selector);
        market.addLiquidity(ROUND, LIQ, FEE, 99, 0, NO_DEADLINE);
        vm.expectRevert(GestureSeriesMarket.InvalidParams.selector);
        market.addLiquidity(ROUND, LIQ, FEE, 9_901, 0, NO_DEADLINE);
        // Fee declaration above the 10% cap.
        vm.expectRevert(GestureSeriesMarket.InvalidParams.selector);
        market.addLiquidity(ROUND, LIQ, 1_001, 5_000, 0, NO_DEADLINE);
        // Zero amount.
        vm.expectRevert(GestureSeriesMarket.InvalidParams.selector);
        market.addLiquidity(ROUND, 0, FEE, 5_000, 0, NO_DEADLINE);
        // Expired deadline.
        vm.expectRevert(GestureSeriesMarket.DeadlineExpired.selector);
        market.addLiquidity(ROUND, LIQ, FEE, 5_000, 0, block.timestamp - 1);
        // Share slippage guard.
        vm.expectRevert(GestureSeriesMarket.Slippage.selector);
        market.addLiquidity(ROUND, LIQ, FEE, 5_000, LIQ + 1, NO_DEADLINE);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // addLiquidity: joining the pool & the fee vote
    // ------------------------------------------------------------------

    function test_joinPoolAtCurrentRatio() public {
        _seedPool(LIQ);

        vm.prank(lpBen);
        uint256 shares = market.addLiquidity(ROUND, 5_000e18, FEE, 0, 0, NO_DEADLINE);

        assertEq(shares, 5_000e18, "50% of the pool's max reserve -> 50% of shares");
        (uint256 rY, uint256 rN) = _reserves(ROUND);
        assertEq(rY, LIQ + 5_000e18);
        assertEq(rN, LIQ + 5_000e18);
        assertEq(_yesBal(lpBen), 0, "no excess in a balanced pool");
        assertEq(_noBal(lpBen), 0);
    }

    function test_joinShiftsTheWeightedFeeTowardTheJoiner() public {
        _seedPoolWith(lpAda, LIQ, 100, 5_000); // 1% opener, weight = LIQ x 100
        assertEq(market.currentFeeBps(ROUND), 100);

        // Ben joins with equal size at 5%: average moves to ~3%.
        vm.prank(lpBen);
        market.addLiquidity(ROUND, LIQ, 500, 0, 0, NO_DEADLINE);
        // weight = LIQ*100 + LIQ*500; shares = 2*LIQ -> 300.
        assertEq(market.currentFeeBps(ROUND), 300, "average of equal-weight 1% and 5% votes");

        // A joiner three times Ada's size dominates the vote.
        vm.prank(carol);
        market.addLiquidity(ROUND, LIQ * 6, 1_000, 0, 0, NO_DEADLINE);
        // weight = LIQ*(100 + 500 + 3000... shares LIQ*6 joined at ratio 2LIQ reserves? join shares = total*cstIn/m.
        uint256 expected = _feeWeight(ROUND) / _totalShares(ROUND);
        assertEq(market.currentFeeBps(ROUND), expected, "average tracks the ledger exactly");
        assertGt(market.currentFeeBps(ROUND), 300, "large high-fee vote raises the average");
        assertLe(market.currentFeeBps(ROUND), 1_000, "average can never exceed the cap");
    }

    function test_rejoiningRedeclaresTheWholePosition() public {
        _seedPoolWith(lpAda, LIQ, 100, 5_000);
        // Ada re-adds a tiny amount at 500: her ENTIRE position now votes 500.
        vm.prank(lpAda);
        market.addLiquidity(ROUND, 1e15, 500, 0, 0, NO_DEADLINE);

        assertEq(_lpDeclaration(ROUND, lpAda), 500);
        // Whole pool: only dead shares still vote 100.
        uint256 adaShares = _lpShares(ROUND, lpAda);
        assertEq(_feeWeight(ROUND), adaShares * 500 + DEAD_SHARES * 100, "old-weight cleanup on re-declare");
    }

    function test_updateFeeDeclarationMovesTheVoteWithoutFunds() public {
        _seedPoolWith(lpAda, LIQ, 100, 5_000);
        uint256 adaShares = _lpShares(ROUND, lpAda);

        vm.expectEmit(true, true, false, true);
        emit GestureSeriesMarket.FeeDeclarationUpdated(ROUND, lpAda, 100, 900);
        vm.prank(lpAda);
        market.updateFeeDeclaration(ROUND, 900);

        assertEq(_lpDeclaration(ROUND, lpAda), 900);
        assertEq(_feeWeight(ROUND), adaShares * 900 + DEAD_SHARES * 100);
        assertEq(market.currentFeeBps(ROUND), (adaShares * 900 + DEAD_SHARES * 100) / (adaShares + DEAD_SHARES));
        (uint256 rY, uint256 rN) = _reserves(ROUND);
        assertEq(rY, LIQ, "reserves untouched by a re-vote");
        assertEq(rN, LIQ);
    }

    function test_updateFeeDeclarationGuards() public {
        _seedPool(LIQ);
        // No shares, no vote.
        vm.prank(alice);
        vm.expectRevert(GestureSeriesMarket.InsufficientShares.selector);
        market.updateFeeDeclaration(ROUND, 100);
        // Above the cap.
        vm.prank(lpAda);
        vm.expectRevert(GestureSeriesMarket.InvalidParams.selector);
        market.updateFeeDeclaration(ROUND, 1_001);
    }

    function test_joinSkewedPoolPreservesPriceAndCreditsExcess() public {
        _seedPool(LIQ);
        // Skew the pool with a bet first.
        vm.prank(alice);
        market.betYes(ROUND, 4_000e18, 0, NO_DEADLINE);
        uint256 probBefore = _probBps(ROUND);
        (uint256 rYBefore, uint256 rNBefore) = _reserves(ROUND);

        vm.prank(lpBen);
        market.addLiquidity(ROUND, 6_000e18, FEE, 0, 0, NO_DEADLINE);

        assertApproxEqAbs(_probBps(ROUND), probBefore, 1, "join must not move the price");
        (uint256 rYAfter, uint256 rNAfter) = _reserves(ROUND);
        assertEq((rYAfter - rYBefore) + _yesBal(lpBen), 6_000e18, "every YES accounted for");
        assertEq((rNAfter - rNBefore) + _noBal(lpBen), 6_000e18, "every NO accounted for");
        uint256 m = rYBefore > rNBefore ? rYBefore : rNBefore;
        if (rYBefore == m) assertEq(rYAfter - rYBefore, 6_000e18);
        else assertEq(rNAfter - rNBefore, 6_000e18);
    }

    function test_joinThenRemoveNeverProfits() public {
        _seedPool(LIQ);
        vm.prank(alice);
        market.betYes(ROUND, 3_333e18, 0, NO_DEADLINE);

        uint256 before = cst.balanceOf(lpBen);
        vm.startPrank(lpBen);
        uint256 shares = market.addLiquidity(ROUND, 1_000e18, FEE, 0, 0, NO_DEADLINE);
        market.removeLiquidity(ROUND, shares, 0, 0, NO_DEADLINE);
        (uint256 yes, uint256 no) = market.balancesOf(ROUND, lpBen);
        market.redeemSets(ROUND, yes < no ? yes : no);
        vm.stopPrank();

        assertLe(cst.balanceOf(lpBen), before, "roundtrip must not pay out more CST than deposited");
    }

    // ------------------------------------------------------------------
    // Betting
    // ------------------------------------------------------------------

    function test_betYesMovesProbabilityUp() public {
        _seedPool(LIQ);
        uint256 before = _probBps(ROUND);

        vm.prank(alice);
        uint256 tokensOut = market.betYes(ROUND, 2_000e18, 0, NO_DEADLINE);

        assertGt(_probBps(ROUND), before, "YES probability should rise");
        assertGt(tokensOut, 2_000e18 - 2_000e18 * uint256(FEE) / BPS, "always get more tokens than net CST");
        assertEq(_yesBal(alice), tokensOut);
        assertEq(_noBal(alice), 0);
    }

    function test_betNoMovesProbabilityDown() public {
        _seedPool(LIQ);
        uint256 before = _probBps(ROUND);

        vm.prank(bob);
        uint256 tokensOut = market.betNo(ROUND, 2_000e18, 0, NO_DEADLINE);

        assertLt(_probBps(ROUND), before, "YES probability should fall");
        assertEq(_noBal(bob), tokensOut);
        assertEq(_yesBal(bob), 0);
    }

    function test_betsChargeTheCurrentWeightedFee() public {
        _seedPoolWith(lpAda, LIQ, 400, 5_000); // 4%
        vm.prank(alice);
        market.betYes(ROUND, 1_000e18, 0, NO_DEADLINE);
        assertEq(_feeReserve(ROUND), 1_000e18 * 400 / BPS, "fee escrowed at the declared 4%");

        // The vote changes; the very next bet pays the new average.
        vm.prank(lpAda);
        market.updateFeeDeclaration(ROUND, 100);
        uint256 feeNow = market.currentFeeBps(ROUND);
        uint256 escrowBefore = _feeReserve(ROUND);
        vm.prank(bob);
        market.betNo(ROUND, 1_000e18, 0, NO_DEADLINE);
        assertEq(_feeReserve(ROUND) - escrowBefore, 1_000e18 * feeNow / BPS, "fee follows the vote");
    }

    function test_quotesMatchActualBets() public {
        _seedPool(LIQ);
        uint256 quotedYes = market.quoteBetYes(ROUND, 1_234e18);
        vm.prank(alice);
        assertEq(market.betYes(ROUND, 1_234e18, 0, NO_DEADLINE), quotedYes);

        uint256 quotedNo = market.quoteBetNo(ROUND, 777e18);
        vm.prank(bob);
        assertEq(market.betNo(ROUND, 777e18, 0, NO_DEADLINE), quotedNo);
    }

    function test_betGuards() public {
        _seedPool(LIQ);
        uint256 quoted = market.quoteBetYes(ROUND, 1_000e18);

        vm.startPrank(alice);
        // Slippage.
        vm.expectRevert(GestureSeriesMarket.Slippage.selector);
        market.betYes(ROUND, 1_000e18, quoted + 1, NO_DEADLINE);
        // Deadline.
        vm.expectRevert(GestureSeriesMarket.DeadlineExpired.selector);
        market.betYes(ROUND, 1_000e18, 0, block.timestamp - 1);
        // Zero amount.
        vm.expectRevert(GestureSeriesMarket.InvalidParams.selector);
        market.betYes(ROUND, 0, 0, NO_DEADLINE);
        // Uninitialized round.
        vm.expectRevert(GestureSeriesMarket.RoundNotInitialized.selector);
        market.betYes(ROUND + 1, 1_000e18, 0, NO_DEADLINE);
        vm.stopPrank();
    }

    /// The NO side has its own slippage check (and every other guard):
    /// mirror of test_betGuards.
    function test_betNoGuards() public {
        _seedPool(LIQ);
        uint256 quoted = market.quoteBetNo(ROUND, 1_000e18);

        vm.startPrank(alice);
        // Slippage: one wei above the quote reverts...
        vm.expectRevert(GestureSeriesMarket.Slippage.selector);
        market.betNo(ROUND, 1_000e18, quoted + 1, NO_DEADLINE);
        // Deadline.
        vm.expectRevert(GestureSeriesMarket.DeadlineExpired.selector);
        market.betNo(ROUND, 1_000e18, 0, block.timestamp - 1);
        // Zero amount.
        vm.expectRevert(GestureSeriesMarket.InvalidParams.selector);
        market.betNo(ROUND, 0, 0, NO_DEADLINE);
        // Uninitialized round.
        vm.expectRevert(GestureSeriesMarket.RoundNotInitialized.selector);
        market.betNo(ROUND + 1, 1_000e18, 0, NO_DEADLINE);
        // ...while a floor of exactly the quote fills: the bound is inclusive.
        assertEq(market.betNo(ROUND, 1_000e18, quoted, NO_DEADLINE), quoted);
        vm.stopPrank();
    }

    /// Quotes report 0 exactly when no bet could fill: no pool yet, or no input.
    function test_quotesAreZeroWhenNothingCanTrade() public {
        assertEq(market.quoteBetYes(ROUND, 1_000e18), 0, "no pool: YES quote");
        assertEq(market.quoteBetNo(ROUND, 1_000e18), 0, "no pool: NO quote");
        assertEq(market.currentFeeBps(ROUND), 0, "no pool: no fee");

        _seedPool(LIQ);
        assertEq(market.quoteBetYes(ROUND, 0), 0, "zero input: YES quote");
        assertEq(market.quoteBetNo(ROUND, 0), 0, "zero input: NO quote");
        assertGt(market.quoteBetYes(ROUND, 1), 0, "a live pool quotes even 1 wei");
        assertGt(market.quoteBetNo(ROUND, 1), 0, "a live pool quotes even 1 wei");
    }

    // ------------------------------------------------------------------
    // Sets
    // ------------------------------------------------------------------

    function test_mintRedeemSetsRoundtripIsFree() public {
        _seedPool(LIQ);
        uint256 before = cst.balanceOf(alice);

        vm.startPrank(alice);
        market.mintSets(ROUND, 100e18);
        assertEq(_yesBal(alice), 100e18);
        assertEq(_noBal(alice), 100e18);
        market.redeemSets(ROUND, 100e18);
        vm.stopPrank();

        assertEq(cst.balanceOf(alice), before, "sets roundtrip is exactly free");
        assertEq(_yesBal(alice), 0);
        assertEq(_noBal(alice), 0);
    }

    function test_setsGuards() public {
        vm.startPrank(alice);
        // Round not initialized yet.
        vm.expectRevert(GestureSeriesMarket.RoundNotInitialized.selector);
        market.mintSets(ROUND, 1e18);
        vm.stopPrank();

        _seedPool(LIQ);

        vm.startPrank(alice);
        vm.expectRevert(GestureSeriesMarket.InvalidParams.selector);
        market.mintSets(ROUND, 0);
        market.mintSets(ROUND, 10e18);
        // Cannot redeem more than the paired amount.
        vm.expectRevert(GestureSeriesMarket.InsufficientShares.selector);
        market.redeemSets(ROUND, 10e18 + 1);
        vm.stopPrank();
    }

    function test_redeemSetsGuards() public {
        _seedPool(LIQ);
        vm.startPrank(alice);
        market.mintSets(ROUND, 10e18);
        // Zero amount.
        vm.expectRevert(GestureSeriesMarket.InvalidParams.selector);
        market.redeemSets(ROUND, 0);
        // A lopsided holder redeems only what pairs up: extra YES from a bet
        // does not make NO appear.
        market.betYes(ROUND, 5e18, 0, NO_DEADLINE);
        assertGt(_yesBal(alice), 10e18);
        vm.expectRevert(GestureSeriesMarket.InsufficientShares.selector);
        market.redeemSets(ROUND, 10e18 + 1);
        market.redeemSets(ROUND, 10e18);
        vm.stopPrank();
        assertEq(_noBal(alice), 0, "every NO was paired and redeemed");
    }

    function test_exitBetEarlyViaOppositeSidePlusRedeem() public {
        _seedPool(LIQ);
        vm.startPrank(alice);
        uint256 yesOut = market.betYes(ROUND, 1_000e18, 0, NO_DEADLINE);
        uint256 noOut = market.betNo(ROUND, 1_000e18, 0, NO_DEADLINE);
        uint256 pairs = yesOut < noOut ? yesOut : noOut;
        market.redeemSets(ROUND, pairs);
        vm.stopPrank();

        assertEq(_yesBal(alice), yesOut - pairs);
        assertEq(_noBal(alice), noOut - pairs);
    }

    function test_redeemSetsStillWorksAfterRoundEndsUnresolved() public {
        _seedPool(LIQ);
        vm.prank(alice);
        market.mintSets(ROUND, 50e18);

        _endRoundWith(THRESHOLD); // round over, nobody resolved yet

        vm.prank(alice);
        market.redeemSets(ROUND, 50e18);
        assertEq(_yesBal(alice), 0);
    }

    // ------------------------------------------------------------------
    // Trading halts
    // ------------------------------------------------------------------

    function test_tradingClosedOnceRoundEnds() public {
        _seedPool(LIQ);
        _endRoundWith(700);

        vm.startPrank(alice);
        vm.expectRevert(GestureSeriesMarket.RoundNotActive.selector);
        market.betYes(ROUND, 1e18, 0, NO_DEADLINE);
        vm.expectRevert(GestureSeriesMarket.RoundNotActive.selector);
        market.betNo(ROUND, 1e18, 0, NO_DEADLINE);
        vm.expectRevert(GestureSeriesMarket.RoundNotActive.selector);
        market.mintSets(ROUND, 1e18);
        vm.stopPrank();
        vm.prank(lpBen);
        vm.expectRevert(GestureSeriesMarket.RoundNotActive.selector);
        market.addLiquidity(ROUND, 1_000e18, FEE, 0, 0, NO_DEADLINE);
    }

    function test_tradingHaltsTheInstantTheOutcomeIsDecided() public {
        _seedPool(LIQ);
        _crossThreshold(); // count > threshold, round still live

        vm.startPrank(alice);
        vm.expectRevert(GestureSeriesMarket.OutcomeDecided.selector);
        market.betYes(ROUND, 1e18, 0, NO_DEADLINE);
        vm.expectRevert(GestureSeriesMarket.OutcomeDecided.selector);
        market.betNo(ROUND, 1e18, 0, NO_DEADLINE);
        vm.stopPrank();

        vm.prank(lpBen);
        vm.expectRevert(GestureSeriesMarket.OutcomeDecided.selector);
        market.addLiquidity(ROUND, 1_000e18, FEE, 0, 0, NO_DEADLINE);

        // LP exit remains open — liquidity is never trapped.
        uint256 shares = _lpShares(ROUND, lpAda);
        vm.prank(lpAda);
        market.removeLiquidity(ROUND, shares / 2, 0, 0, NO_DEADLINE);
    }

    // ------------------------------------------------------------------
    // Resolution
    // ------------------------------------------------------------------

    function test_resolveRevertsWhileUncertain() public {
        _seedPool(LIQ);
        vm.expectRevert(GestureSeriesMarket.NotResolvable.selector);
        market.resolve(ROUND);
    }

    function test_resolveUninitializedRoundReverts() public {
        vm.expectRevert(GestureSeriesMarket.RoundNotInitialized.selector);
        market.resolve(ROUND);
    }

    function test_resolveAfterRoundEndYesWins() public {
        _seedPool(LIQ);
        _endRoundWith(THRESHOLD + 123);

        vm.expectEmit(true, false, false, true);
        emit GestureSeriesMarket.Resolved(ROUND, THRESHOLD + 123, true);
        market.resolve(ROUND);

        RoundView memory v = _state(ROUND);
        assertTrue(v.resolved);
        assertTrue(v.yesWon);
    }

    function test_resolveAfterRoundEndNoWins() public {
        _seedPool(LIQ);
        _endRoundWith(THRESHOLD - 1);
        market.resolve(ROUND);
        assertFalse(_state(ROUND).yesWon);
    }

    function test_tieMeansNoWins() public {
        _seedPool(LIQ);
        _endRoundWith(THRESHOLD); // exactly equal
        market.resolve(ROUND);
        assertFalse(_state(ROUND).yesWon, "strictly greater required: a tie pays NO");
    }

    function test_earlyResolveTheMomentThresholdIsCrossed() public {
        _seedPool(LIQ);
        _crossThreshold(); // round still live!

        market.resolve(ROUND);
        RoundView memory v = _state(ROUND);
        assertTrue(v.resolved);
        assertTrue(v.yesWon);
        assertTrue(v.roundActive, "resolved early while the round is still running");
    }

    function test_noEarlyResolveForNo() public {
        _seedPool(LIQ);
        game.setNumBids(ROUND, THRESHOLD); // equal is not strictly greater
        vm.expectRevert(GestureSeriesMarket.NotResolvable.selector);
        market.resolve(ROUND);
    }

    function test_resolveOnlyOnce() public {
        _seedPool(LIQ);
        _endRoundWith(900);
        market.resolve(ROUND);
        vm.expectRevert(GestureSeriesMarket.AlreadyResolved.selector);
        market.resolve(ROUND);
    }

    function test_nothingTradesAfterResolution() public {
        _seedPool(LIQ);
        vm.prank(alice);
        market.mintSets(ROUND, 10e18);
        _crossThreshold();
        market.resolve(ROUND);

        vm.startPrank(alice);
        vm.expectRevert(GestureSeriesMarket.AlreadyResolved.selector);
        market.betYes(ROUND, 1e18, 0, NO_DEADLINE);
        vm.expectRevert(GestureSeriesMarket.AlreadyResolved.selector);
        market.mintSets(ROUND, 1e18);
        vm.expectRevert(GestureSeriesMarket.AlreadyResolved.selector);
        market.redeemSets(ROUND, 1e18);
        vm.stopPrank();
        vm.prank(lpBen);
        vm.expectRevert(GestureSeriesMarket.AlreadyResolved.selector);
        market.addLiquidity(ROUND, 1_000e18, FEE, 0, 0, NO_DEADLINE);
    }

    // ------------------------------------------------------------------
    // Claims
    // ------------------------------------------------------------------

    function test_claimBeforeResolveReverts() public {
        _seedPool(LIQ);
        vm.expectRevert(GestureSeriesMarket.NotResolved.selector);
        vm.prank(alice);
        market.claim(ROUND);
    }

    function test_claimPaysWinnersOneToOneAndLosersZero() public {
        _seedPool(LIQ);
        vm.prank(alice);
        uint256 aliceYes = market.betYes(ROUND, 2_000e18, 0, NO_DEADLINE);
        vm.prank(bob);
        uint256 bobNo = market.betNo(ROUND, 1_500e18, 0, NO_DEADLINE);

        _endRoundWith(THRESHOLD + 500); // YES wins
        market.resolve(ROUND);

        uint256 aliceBefore = cst.balanceOf(alice);
        vm.prank(alice);
        assertEq(market.claim(ROUND), aliceYes, "1 CST per winning token");
        assertEq(cst.balanceOf(alice) - aliceBefore, aliceYes);
        assertGt(aliceYes, 2_000e18, "winning YES bet beats its cost");

        vm.prank(bob);
        assertEq(market.claim(ROUND), 0, "losing tokens pay nothing");
        assertGt(bobNo, 0);
        assertEq(_noBal(bob), 0, "losing balance zeroed too");
    }

    function test_claimIsIdempotent() public {
        _seedPool(LIQ);
        vm.prank(alice);
        market.betYes(ROUND, 1_000e18, 0, NO_DEADLINE);
        _endRoundWith(THRESHOLD + 1);
        market.resolve(ROUND);

        vm.prank(alice);
        uint256 first = market.claim(ROUND);
        assertGt(first, 0);
        vm.prank(alice);
        assertEq(market.claim(ROUND), 0, "second claim pays nothing");
    }

    // ------------------------------------------------------------------
    // LP lifecycle: remove, fees
    // ------------------------------------------------------------------

    function test_removeLiquidityProRata() public {
        uint256 shares = _seedPool(LIQ);
        (uint256 rY, uint256 rN) = _reserves(ROUND);
        uint256 total = _totalShares(ROUND);

        vm.prank(lpAda);
        (uint256 yesOut, uint256 noOut,) = market.removeLiquidity(ROUND, shares / 2, 0, 0, NO_DEADLINE);

        assertEq(yesOut, rY * (shares / 2) / total);
        assertEq(noOut, rN * (shares / 2) / total);
        assertEq(_yesBal(lpAda), yesOut);
        assertEq(_noBal(lpAda), noOut);
    }

    function test_removeLiquidityRemovesTheFeeVote() public {
        _seedPoolWith(lpAda, LIQ, 100, 5_000);
        vm.prank(lpBen);
        market.addLiquidity(ROUND, LIQ, 500, 0, 0, NO_DEADLINE);
        assertEq(market.currentFeeBps(ROUND), 300);

        // Ben leaves entirely: the average returns to ~1% (dead shares vote 100 too).
        uint256 benShares = _lpShares(ROUND, lpBen);
        vm.prank(lpBen);
        market.removeLiquidity(ROUND, benShares, 0, 0, NO_DEADLINE);
        assertEq(market.currentFeeBps(ROUND), 100, "departed shares stop voting");
        assertEq(_feeWeight(ROUND), _totalShares(ROUND) * 100);
    }

    function test_removeLiquidityGuards() public {
        uint256 shares = _seedPool(LIQ);
        vm.startPrank(lpAda);
        vm.expectRevert(GestureSeriesMarket.InsufficientShares.selector);
        market.removeLiquidity(ROUND, shares + 1, 0, 0, NO_DEADLINE);
        vm.expectRevert(GestureSeriesMarket.InsufficientShares.selector);
        market.removeLiquidity(ROUND, 0, 0, 0, NO_DEADLINE);
        vm.expectRevert(GestureSeriesMarket.DeadlineExpired.selector);
        market.removeLiquidity(ROUND, shares, 0, 0, block.timestamp - 1);
        vm.expectRevert(GestureSeriesMarket.Slippage.selector);
        market.removeLiquidity(ROUND, shares, type(uint256).max, 0, NO_DEADLINE);
        vm.stopPrank();
        // Non-LP has nothing to remove.
        vm.prank(alice);
        vm.expectRevert(GestureSeriesMarket.InsufficientShares.selector);
        market.removeLiquidity(ROUND, 1, 0, 0, NO_DEADLINE);
    }

    function test_removeLiquidityAfterResolutionAndClaim() public {
        uint256 shares = _seedPool(LIQ);
        vm.prank(alice);
        market.betYes(ROUND, 3_000e18, 0, NO_DEADLINE);

        _endRoundWith(THRESHOLD + 10);
        market.resolve(ROUND);

        vm.startPrank(lpAda);
        (uint256 yesOut, uint256 noOut, uint256 fees) = market.removeLiquidity(ROUND, shares, 0, 0, NO_DEADLINE);
        uint256 claimed = market.claim(ROUND);
        vm.stopPrank();

        assertGt(fees, 0, "LP earned the bet fee");
        assertEq(claimed, yesOut, "post-resolution the YES side pays 1:1");
        assertGt(noOut, 0, "the losing side came out too (worth 0)");
    }

    function test_feesAccrueToLpsProRataByShares() public {
        _seedPoolWith(lpAda, LIQ, 100, 5_000); // Ada votes 1%
        vm.prank(lpBen);
        market.addLiquidity(ROUND, LIQ / 2, 500, 0, 0, NO_DEADLINE); // Ben votes 5%

        vm.prank(alice);
        market.betYes(ROUND, 9_000e18, 0, NO_DEADLINE);
        uint256 fee = 9_000e18 * market.currentFeeBps(ROUND) / BPS;
        // The fee charged used the pre-bet average; recompute the escrow directly.
        assertEq(_feeReserve(ROUND), fee, "whole fee escrowed at the average");

        // Earnings split by SHARES, not by declarations: Ada holds ~2/3.
        uint256 adaPending = _lpPending(ROUND, lpAda);
        uint256 benPending = _lpPending(ROUND, lpBen);
        assertApproxEqAbs(adaPending, fee * 2 / 3, 1e6, "Ada earns ~2/3 despite voting low");
        assertApproxEqAbs(benPending, fee / 3, 1e6, "Ben earns ~1/3 despite voting high");
        assertLe(adaPending + benPending, fee, "cannot claim more than escrowed");

        uint256 adaBefore = cst.balanceOf(lpAda);
        vm.prank(lpAda);
        assertEq(market.claimFees(ROUND), adaPending);
        assertEq(cst.balanceOf(lpAda) - adaBefore, adaPending);
        assertEq(_lpPending(ROUND, lpAda), 0, "pending resets after claim");
    }

    function test_lateJoinerEarnsNoFeesFromEarlierBets() public {
        _seedPool(LIQ);
        vm.prank(alice);
        market.betYes(ROUND, 5_000e18, 0, NO_DEADLINE); // fee #1: Ada only

        vm.prank(lpBen);
        market.addLiquidity(ROUND, LIQ, FEE, 0, 0, NO_DEADLINE);
        assertEq(_lpPending(ROUND, lpBen), 0, "no retroactive fees for late joiners");

        vm.prank(bob);
        market.betNo(ROUND, 5_000e18, 0, NO_DEADLINE); // fee #2: split
        assertGt(_lpPending(ROUND, lpBen), 0, "late joiner earns from later bets");
    }

    function test_claimFeesOnEmptyPositionIsZero() public {
        _seedPool(LIQ);
        vm.prank(carol);
        assertEq(market.claimFees(ROUND), 0);
    }

    // ------------------------------------------------------------------
    // Full lifecycle & multi-round
    // ------------------------------------------------------------------

    function test_fullLifecycleConservesCstToDust() public {
        _seedPoolWith(lpAda, LIQ, 100, 5_000);
        vm.prank(lpBen);
        market.addLiquidity(ROUND, 4_000e18, 700, 0, 0, NO_DEADLINE);

        vm.prank(alice);
        market.betYes(ROUND, 6_000e18, 0, NO_DEADLINE);
        vm.prank(lpBen);
        market.updateFeeDeclaration(ROUND, 50);
        vm.prank(bob);
        market.betNo(ROUND, 3_000e18, 0, NO_DEADLINE);
        vm.startPrank(carol);
        market.mintSets(ROUND, 1_000e18);
        market.redeemSets(ROUND, 400e18);
        vm.stopPrank();

        _endRoundWith(THRESHOLD + 42);
        market.resolve(ROUND);

        // Everyone exits everything.
        address[5] memory everyone = [lpAda, lpBen, alice, bob, carol];
        for (uint256 i = 0; i < everyone.length; i++) {
            uint256 shares = _lpShares(ROUND, everyone[i]);
            if (shares > 0) {
                vm.prank(everyone[i]);
                market.removeLiquidity(ROUND, shares, 0, 0, NO_DEADLINE);
            }
            vm.prank(everyone[i]);
            market.claimFees(ROUND);
            vm.prank(everyone[i]);
            market.claim(ROUND);
        }

        // Only dead-share reserves and rounding dust may remain.
        assertLt(cst.balanceOf(address(market)), 1e6, "more than dust stuck after full drain");
    }

    function test_consecutiveRoundsRunIndependently() public {
        _seedPool(LIQ);
        vm.prank(alice);
        market.betYes(ROUND, 1_000e18, 0, NO_DEADLINE);

        // Round ends at 950 (> 800): YES wins round 5; round 6's threshold is 950.
        _endRoundWith(950);
        market.resolve(ROUND);

        vm.prank(lpBen);
        market.addLiquidity(ROUND + 1, LIQ, 500, 5_000, 0, NO_DEADLINE);
        assertEq(_state(ROUND + 1).threshold, 950, "next round compares against the new count");
        assertEq(market.currentFeeBps(ROUND + 1), 500, "fresh pool, fresh fee vote");
        assertEq(market.currentFeeBps(ROUND), FEE, "old round's vote untouched");

        vm.prank(bob);
        market.betNo(ROUND + 1, 500e18, 0, NO_DEADLINE);
        (uint256 rY,) = _reserves(ROUND);
        assertGt(rY, 0, "old round's pool untouched by new round's trading");

        // Old round claims still work while the new round trades.
        vm.prank(alice);
        assertGt(market.claim(ROUND), 0);
    }

    function test_roundStateViewCoherent() public {
        RoundView memory v = _state(ROUND);
        assertFalse(v.initialized);
        assertTrue(v.roundActive);
        assertTrue(v.thresholdKnown, "current round's threshold is knowable pre-init");
        assertEq(v.threshold, THRESHOLD, "view reports the live (final) value before locking");

        _seedPool(LIQ);
        game.setNumBids(ROUND, 500);
        v = _state(ROUND);
        assertEq(v.threshold, THRESHOLD);
        assertEq(v.currentCount, 500);
        assertFalse(v.outcomeDecided);

        _crossThreshold();
        assertTrue(_state(ROUND).outcomeDecided);
    }

    function test_roundStateViewForFutureAndRoundZero() public view {
        // A future round: threshold unknowable, never active, never decided.
        RoundView memory v = _state(ROUND + 3);
        assertFalse(v.initialized);
        assertFalse(v.thresholdKnown);
        assertEq(v.threshold, 0);
        assertFalse(v.roundActive);
        assertFalse(v.outcomeDecided);

        // Round 0 never has a threshold (no previous round), even when past.
        v = _state(0);
        assertFalse(v.thresholdKnown);
        assertEq(v.threshold, 0);
    }

    // ------------------------------------------------------------------
    // Round end: everything freezes except withdrawals
    // ------------------------------------------------------------------

    function test_endedRoundIsWithdrawOnly() public {
        _seedPool(LIQ);
        vm.prank(alice);
        market.betYes(ROUND, 1_000e18, 0, NO_DEADLINE);
        vm.prank(bob);
        market.mintSets(ROUND, 100e18);

        _endRoundWith(THRESHOLD); // round over, deliberately left unresolved

        // Every way of putting funds IN is closed...
        vm.startPrank(alice);
        vm.expectRevert(GestureSeriesMarket.RoundNotActive.selector);
        market.betYes(ROUND, 1e18, 0, NO_DEADLINE);
        vm.expectRevert(GestureSeriesMarket.RoundNotActive.selector);
        market.betNo(ROUND, 1e18, 0, NO_DEADLINE);
        vm.expectRevert(GestureSeriesMarket.RoundNotActive.selector);
        market.mintSets(ROUND, 1e18);
        vm.stopPrank();
        vm.prank(lpBen);
        vm.expectRevert(GestureSeriesMarket.RoundNotActive.selector);
        market.addLiquidity(ROUND, 1_000e18, FEE, 0, 0, NO_DEADLINE);

        // ...while every way of taking funds OUT still works.
        vm.startPrank(lpAda);
        market.updateFeeDeclaration(ROUND, 50); // harmless: no bets can ever pay it
        (uint256 yesOut, uint256 noOut, uint256 fees) =
            market.removeLiquidity(ROUND, _lpShares(ROUND, lpAda) / 2, 0, 0, NO_DEADLINE);
        assertGt(yesOut + noOut, 0);
        assertGt(fees, 0, "fees from the pre-end bet still claimable");
        vm.stopPrank();
        vm.prank(bob);
        market.redeemSets(ROUND, 100e18); // paired exit needs no resolution
    }

    function test_endedUnresolvedRoundAllowsFullLpExit() public {
        uint256 shares = _seedPool(LIQ);
        vm.prank(alice);
        market.betYes(ROUND, 2_000e18, 0, NO_DEADLINE);

        _endRoundWith(THRESHOLD); // ended; NOBODY resolves

        vm.startPrank(lpAda);
        (uint256 yesOut, uint256 noOut,) = market.removeLiquidity(ROUND, shares, 0, 0, NO_DEADLINE);
        uint256 pairs = yesOut < noOut ? yesOut : noOut;
        market.redeemSets(ROUND, pairs);
        vm.stopPrank();
        assertEq(_lpShares(ROUND, lpAda), 0, "full exit without any resolution");

        // The one-sided remainder pays out the moment anyone resolves.
        market.resolve(ROUND); // tie: NO wins
        (uint256 yesLeft, uint256 noLeft) = market.balancesOf(ROUND, lpAda);
        assertGt(noLeft, 0, "YES bet skewed the pool toward NO inventory");
        vm.prank(lpAda);
        assertEq(market.claim(ROUND), noLeft, "surviving NO pays 1:1; leftover YES pays 0");
        assertEq(yesLeft, 0, "pairs were redeemed down to one side");
    }

    function test_claimThenRemoveThenClaimAgain() public {
        uint256 shares = _seedPool(LIQ);
        vm.prank(lpAda);
        market.betYes(ROUND, 1_000e18, 0, NO_DEADLINE); // LP also bets personally

        _endRoundWith(THRESHOLD + 1);
        market.resolve(ROUND);

        // Claim the personal position FIRST...
        (uint256 personalYes,) = market.balancesOf(ROUND, lpAda);
        vm.prank(lpAda);
        assertEq(market.claim(ROUND), personalYes);

        // ...then unwind the LP position and claim AGAIN for the pool-side YES.
        vm.prank(lpAda);
        (uint256 yesOut,,) = market.removeLiquidity(ROUND, shares, 0, 0, NO_DEADLINE);
        vm.prank(lpAda);
        assertEq(market.claim(ROUND), yesOut, "second claim pays the just-withdrawn winning reserves");
    }

    // ------------------------------------------------------------------
    // Future rounds: fund, trade, lock, resolve
    // ------------------------------------------------------------------

    function test_addLiquidityInitializesFutureRound() public {
        uint256 future = ROUND + 2;
        vm.expectEmit(true, false, false, true);
        emit GestureSeriesMarket.RoundInitialized(future);
        vm.prank(lpAda);
        uint256 shares = market.addLiquidity(future, LIQ, FEE, 3_000, 0, NO_DEADLINE);
        assertGt(shares, 0);

        RoundView memory v = _state(future);
        assertTrue(v.initialized);
        assertFalse(v.thresholdKnown, "a future round has no threshold yet");
        assertEq(v.threshold, 0);
        assertFalse(v.roundActive);
        assertFalse(v.outcomeDecided);
        assertApproxEqAbs(_probBps(future), 3_000, 1, "first LP still sets the opening odds");
    }

    function test_betAndSetsWorkOnFutureRound() public {
        uint256 future = ROUND + 2;
        _seedRoundPool(future, lpAda, LIQ);

        uint256 quoted = market.quoteBetYes(future, 1_000e18);
        vm.prank(alice);
        assertEq(market.betYes(future, 1_000e18, quoted, NO_DEADLINE), quoted, "future-round quote == execution");

        vm.startPrank(bob);
        market.mintSets(future, 50e18);
        market.redeemSets(future, 20e18);
        vm.stopPrank();
        (uint256 yes, uint256 no) = market.balancesOf(future, bob);
        assertEq(yes, 30e18);
        assertEq(no, 30e18);

        // Liquidity management is equally open pre-round.
        vm.prank(lpBen);
        uint256 benShares = market.addLiquidity(future, LIQ / 2, 300, 0, 0, NO_DEADLINE);
        vm.prank(lpBen);
        market.removeLiquidity(future, benShares, 0, 0, NO_DEADLINE);
    }

    function test_futureRoundNeverResolvableNorDecided() public {
        uint256 future = ROUND + 2;
        _seedRoundPool(future, lpAda, LIQ);

        // However the surrounding data moves, nothing about a future round is
        // certain: not even hostile game values can halt or resolve it.
        game.setNumBids(ROUND, 10_000);
        game.setNumBids(future - 1, 123_456);
        assertFalse(_state(future).outcomeDecided);
        vm.expectRevert(GestureSeriesMarket.NotResolvable.selector);
        market.resolve(future);

        vm.prank(alice);
        market.betNo(future, 100e18, 0, NO_DEADLINE); // trading never halted
    }

    function test_thresholdLocksOnFirstTouchViaAdd() public {
        uint256 future = ROUND + 1;
        _seedRoundPool(future, lpAda, LIQ);
        assertFalse(_state(future).thresholdKnown);

        _endRoundWith(950); // ROUND ends with 950; `future` is now current

        vm.expectEmit(true, false, false, true);
        emit GestureSeriesMarket.ThresholdLocked(future, 950);
        vm.prank(lpBen);
        market.addLiquidity(future, 1_000e18, FEE, 0, 0, NO_DEADLINE);

        RoundView memory v = _state(future);
        assertTrue(v.thresholdKnown);
        assertEq(v.threshold, 950, "locked at the previous round's final count");
    }

    function test_thresholdLocksOnFirstTouchViaBet() public {
        uint256 future = ROUND + 1;
        _seedRoundPool(future, lpAda, LIQ);
        _endRoundWith(950);

        vm.expectEmit(true, false, false, true);
        emit GestureSeriesMarket.ThresholdLocked(future, 950);
        vm.prank(alice);
        market.betYes(future, 100e18, 0, NO_DEADLINE);
        assertEq(_state(future).threshold, 950);
    }

    function test_thresholdLocksLazilyAtResolveIfNeverTouched() public {
        uint256 future = ROUND + 1;
        _seedRoundPool(future, lpAda, LIQ);
        vm.prank(alice);
        market.betYes(future, 500e18, 0, NO_DEADLINE); // position taken pre-round

        // ROUND ends at 950; `future` runs to 1000 and ends; two more rounds
        // pass — all without anyone touching this market.
        _endRoundWith(950);
        game.setNumBids(future, 1_000);
        game.setRoundNum(future + 3);

        vm.expectEmit(true, false, false, true);
        emit GestureSeriesMarket.ThresholdLocked(future, 950);
        market.resolve(future);
        RoundView memory v = _state(future);
        assertTrue(v.resolved);
        assertTrue(v.yesWon, "1000 > 950");
        assertEq(v.threshold, 950, "lazy lock reads the identical final value");

        (uint256 aliceYes,) = market.balancesOf(future, alice);
        vm.prank(alice);
        assertEq(market.claim(future), aliceYes);
    }

    function test_futureRoundFullLifecycleConservesCst() public {
        uint256 future = ROUND + 1;
        // Phase 1 (future): positions taken before the round exists.
        _seedRoundPool(future, lpAda, LIQ);
        vm.prank(alice);
        market.betYes(future, 3_000e18, 0, NO_DEADLINE);

        // Phase 2 (current): threshold reveals at 700; more trading.
        _endRoundWith(700);
        vm.prank(bob);
        market.betNo(future, 2_000e18, 0, NO_DEADLINE);

        // Phase 3 (past): the round ends below the bar; NO wins.
        game.setNumBids(future, 650);
        game.setRoundNum(future + 1);
        market.resolve(future);

        address[3] memory everyone = [lpAda, alice, bob];
        for (uint256 i = 0; i < everyone.length; i++) {
            uint256 shares = _lpShares(future, everyone[i]);
            if (shares > 0) {
                vm.prank(everyone[i]);
                market.removeLiquidity(future, shares, 0, 0, NO_DEADLINE);
            }
            vm.prank(everyone[i]);
            market.claimFees(future);
            vm.prank(everyone[i]);
            market.claim(future);
        }
        assertLt(cst.balanceOf(address(market)), 1e6, "cross-phase lifecycle left more than dust");
    }

    function test_farFutureRoundFundTradeAndExitInKind() public {
        uint256 far = ROUND + 1_000;
        _seedRoundPool(far, lpAda, LIQ);
        vm.prank(alice);
        market.betYes(far, 1_000e18, 0, NO_DEADLINE);

        vm.expectRevert(GestureSeriesMarket.NotResolvable.selector);
        market.resolve(far);

        // Everyone can leave in-kind long before the round ever arrives.
        vm.startPrank(lpAda);
        market.removeLiquidity(far, _lpShares(far, lpAda), 0, 0, NO_DEADLINE);
        market.claimFees(far);
        (uint256 yes, uint256 no) = market.balancesOf(far, lpAda);
        market.redeemSets(far, yes < no ? yes : no);
        vm.stopPrank();

        // The one-sided bettor exits by buying the other side (works even
        // against the dust left after the LP is gone) and redeeming pairs.
        vm.startPrank(alice);
        market.betNo(far, 1_100e18, 0, NO_DEADLINE);
        (yes, no) = market.balancesOf(far, alice);
        market.redeemSets(far, yes < no ? yes : no);
        vm.stopPrank();
    }

    function test_roundOneFundableDuringRoundZero() public {
        game.setRoundNum(0);
        vm.prank(lpAda);
        market.addLiquidity(1, LIQ, FEE, 5_000, 0, NO_DEADLINE); // round 1 as a future round
        assertFalse(_state(1).thresholdKnown);

        game.setNumBids(0, 42); // round 0 gathers gestures...
        game.setRoundNum(1); // ...and ends
        vm.prank(alice);
        market.betYes(1, 100e18, 0, NO_DEADLINE);
        assertEq(_state(1).threshold, 42, "round 1 compares against round 0's final count");
    }

    function test_multipleRoundsTradeConcurrentlyAndStayIsolated() public {
        _seedPool(LIQ); // current
        uint256 f1 = ROUND + 1;
        uint256 f2 = ROUND + 7;
        _seedRoundPool(f1, lpBen, LIQ / 2);
        vm.prank(carol);
        market.addLiquidity(f2, LIQ / 4, 900, 2_000, 0, NO_DEADLINE);

        vm.startPrank(alice);
        market.betYes(ROUND, 1_000e18, 0, NO_DEADLINE);
        market.betNo(f1, 500e18, 0, NO_DEADLINE);
        market.betYes(f2, 250e18, 0, NO_DEADLINE);
        vm.stopPrank();

        assertEq(market.currentFeeBps(ROUND), FEE);
        assertEq(market.currentFeeBps(f1), FEE);
        assertEq(market.currentFeeBps(f2), 900);
        (uint256 rY1,) = _reserves(f1);

        // Resolving the current round leaves the future books untouched.
        _endRoundWith(THRESHOLD + 1);
        market.resolve(ROUND);
        (uint256 rY1After,) = _reserves(f1);
        assertEq(rY1After, rY1, "future pool moved by another round's resolution");
        assertFalse(_state(f1).resolved);
        assertTrue(_state(f2).initialized, "future markets persist");
    }
}
