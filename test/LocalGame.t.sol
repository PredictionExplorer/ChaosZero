// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {LocalCst} from "../src/local/LocalCst.sol";
import {LocalCosmicGame} from "../src/local/LocalCosmicGame.sol";
import {LocalOutcomeSource} from "../src/local/LocalOutcomeSource.sol";
import {CycleMetrics} from "../src/local/CycleMetrics.sol";

contract MetricsHarness {
    using CycleMetrics for CycleMetrics.Metrics;
    CycleMetrics.Metrics private _metrics;

    function observe(bool cst, uint256 paid, uint256 time) external {
        _metrics.observe(cst, paid, time);
    }

    function finish(uint256 time) external {
        _metrics.finish(time);
    }

    function current(uint256 time) external view returns (CycleMetrics.Metrics memory) {
        return _metrics.current(time);
    }
}

contract LocalGameTest is Test {
    LocalCosmicGame private game;
    LocalOutcomeSource private source;
    LocalCst private cst;
    address private alice = makeAddr("alice");

    function setUp() public {
        vm.chainId(31337);
        vm.warp(100_000);
        game = new LocalCosmicGame();
        source = new LocalOutcomeSource(game);
        cst = game.token();
        vm.deal(alice, 100 ether);
        vm.prank(alice);
        cst.faucet(10_000 ether);
    }

    function test_localContractsCannotBeDeployedOnMainnet() public {
        vm.chainId(42161);
        vm.expectRevert(LocalCosmicGame.LocalChainOnly.selector);
        new LocalCosmicGame();
        vm.expectRevert(LocalCst.LocalChainOnly.selector);
        new LocalCst(alice);
        vm.expectRevert(LocalOutcomeSource.LocalChainOnly.selector);
        new LocalOutcomeSource(game);
    }

    function test_baselineWasReplayedAndIsFinal() public view {
        CycleMetrics.Metrics memory m = game.roundStats(0);
        assertEq(m.gestureCount, 6);
        assertEq(m.ethSpent, 0.045 ether);
        assertEq(m.cstBurned, 600 ether);
        assertEq(m.highestCstPaid, 300 ether);
        assertEq(m.enduranceDuration, 600);
        assertEq(m.chronoDuration, 1620);
        assertEq(m.enduranceGesture, 3);
        assertEq(m.chronoGesture, 3);
        assertTrue(m.finalized);
    }

    function test_unstartedRoundIsOpenAndHasNoKnownAnswers() public view {
        (bool open, bool final_, uint8 known, uint8 values) = source.outcomeState(1);
        assertTrue(open);
        assertFalse(final_);
        assertEq(known, 0);
        assertEq(values, 0);
    }

    function test_metricsExposeActualValuesAndAvailability() public {
        assertTrue(source.metrics(0).supported);
        assertTrue(source.metrics(0).finalized);
        assertFalse(source.metrics(2).supported);
        _eth();
        assertEq(source.metrics(1).gestureCount, 1);
        assertEq(source.metrics(1).ethSpent, 0.01 ether);
        assertFalse(source.metrics(1).finalized);
        assertFalse(source.metrics(1).sameGesture);
        vm.warp(game.mainPrizeTime());
        vm.prank(alice);
        game.closeCycle();
        assertTrue(source.metrics(1).finalized);
        assertTrue(source.metrics(1).sameGesture);
        assertTrue(source.metrics(2).supported);
    }

    function testFuzz_fixtureCanStartAtAnyTimestamp(uint64 timestamp) public {
        vm.warp(timestamp);
        LocalCosmicGame earlyGame = new LocalCosmicGame();
        CycleMetrics.Metrics memory previous = earlyGame.roundStats(0);
        assertTrue(previous.finalized);
        assertEq(previous.gestureCount, 6);
        assertLe(previous.lastGestureTime, timestamp);
        assertLe(previous.firstGestureTime, previous.lastGestureTime);
    }

    function test_cannotInventUnsupportedRoundsOrFirstCstGesture() public {
        (bool open, bool final_, uint8 known, uint8 values) = source.outcomeState(2);
        assertFalse(open);
        assertFalse(final_);
        assertEq(known, 0);
        assertEq(values, 0);
        vm.prank(alice);
        vm.expectRevert(LocalCosmicGame.FirstGestureMustBeEth.selector);
        game.bidCst(type(uint256).max);
        vm.expectRevert(LocalCosmicGame.NotReady.selector);
        game.closeCycle();
    }

    function test_priceFeedbackAndCstBurnAreRealAccounting() public {
        uint256 d = game.cstDuration();
        _eth();
        assertEq(game.cstDuration(), (d + 1) * 250 / 251);
        uint256 p = game.getNextCstPrice();
        uint256 before_ = cst.balanceOf(alice);
        vm.prank(alice);
        game.bidCst(p);
        assertEq(cst.balanceOf(alice), before_ - p);
        assertEq(game.roundStats(1).cstBurned, p);
        assertEq(game.cstOpeningPrice(), p * 2);
    }

    function test_freeCstStillCountsAndResetsToMinimum() public {
        _eth();
        vm.warp(block.timestamp + game.cstDuration());
        assertEq(game.getNextCstPrice(), 0);
        vm.prank(alice);
        game.bidCst(0);
        CycleMetrics.Metrics memory m = game.roundStats(1);
        assertEq(m.gestureCount, 2);
        assertEq(m.cstBurned, 0);
        assertEq(game.cstOpeningPrice(), 200 ether);
        assertGt(cst.balanceOf(alice), 10_000 ether);
    }

    function test_evenGestureTotalIsUnknownWhileOpenAndThenNo() public {
        _eth();
        vm.prank(alice);
        game.bidCst(type(uint256).max);
        _assertParityUnknown();
        assertEq(_closeCycle() & 32, 0);
    }

    function test_oddGestureTotalIsUnknownWhileOpenAndThenYes() public {
        _eth();
        _assertParityUnknown();
        vm.prank(alice);
        game.bidCst(type(uint256).max);
        _assertParityUnknown();
        _eth();
        _assertParityUnknown();
        assertEq(_closeCycle() & 32, 32);
    }

    function test_freeCstGestureFlipsParity() public {
        _eth();
        vm.warp(vm.getBlockTimestamp() + game.cstDuration());
        assertEq(game.getNextCstPrice(), 0);
        uint256 beforeFreeGesture = vm.snapshotState();
        assertEq(_closeCycle() & 32, 32);
        vm.revertToState(beforeFreeGesture);
        vm.prank(alice);
        game.bidCst(0);
        assertEq(game.roundStats(1).cstBurned, 0);
        _assertParityUnknown();
        assertEq(_closeCycle() & 32, 0);
    }

    function test_fuzz_parityIsUnknownUntilClosureAndThenMatchesGestureCount(
        uint256 count,
        uint256 choices,
        uint32[40] memory gaps
    ) public {
        _exerciseParity(bound(count, 1, gaps.length), choices, gaps);
    }

    function test_immediateCstGesturesRemainCoveredByTheParityHarness() public {
        uint32[40] memory gaps;
        _exerciseParity(gaps.length, type(uint256).max, gaps);
    }

    function test_clockAloneCanMakeTimingThresholdsCertain() public {
        _eth();
        vm.warp(block.timestamp + 1621);
        (,, uint8 known, uint8 values) = source.outcomeState(1);
        assertEq(known & 6, 6);
        assertEq(values & 6, 6);
        assertEq(known & 96, 0);
    }

    function test_closeUsesActualClaimTimeAndOpensNextCycle() public {
        _eth();
        vm.warp(game.mainPrizeTime() + 100);
        uint256 before_ = block.timestamp;
        vm.prank(alice);
        game.closeCycle();
        assertEq(game.roundNum(), 2);
        CycleMetrics.Metrics memory m = game.roundStats(1);
        assertEq(m.enduranceDuration, before_ - m.firstGestureTime);
        assertEq(m.chronoDuration, m.enduranceDuration);
        assertEq(m.enduranceGesture, 1);
        assertEq(m.chronoGesture, 1);
        (bool open,,,) = source.outcomeState(2);
        assertTrue(open);
    }

    function test_anyoneCanCloseAfterLocalTimeout() public {
        _eth();
        vm.warp(game.mainPrizeTime());
        vm.expectRevert(LocalCosmicGame.NotReady.selector);
        game.closeCycle();
        vm.warp(game.mainPrizeTime() + game.CLAIM_TIMEOUT());
        game.closeCycle();
        assertEq(game.roundNum(), 2);
    }

    /// @dev Markets never end early: the adapter's open flag follows the round counter alone,
    /// so neither the countdown, the claim timeout nor known answers close the cycle.
    function test_openFollowsTheRoundCounterNotTheCountdownOrKnownAnswers() public {
        for (uint256 i; i < 7; ++i) {
            _eth();
        }
        (bool open, bool final_, uint8 known, uint8 values) = source.outcomeState(1);
        assertTrue(open);
        assertFalse(final_);
        assertEq(known & 1, 1);
        assertEq(values & 1, 1);
        uint256[2] memory checkpoints = [game.mainPrizeTime(), game.mainPrizeTime() + game.CLAIM_TIMEOUT() + 1 days];
        for (uint256 i; i < checkpoints.length; ++i) {
            vm.warp(checkpoints[i]);
            uint8 previousKnown = known;
            uint8 previousValues = values;
            (open, final_, known, values) = source.outcomeState(1);
            assertTrue(open);
            assertFalse(final_);
            assertEq(known & previousKnown, previousKnown);
            assertEq(values & previousKnown, previousValues & previousKnown);
            assertEq(game.roundNum(), 1);
        }
        // The clock alone made the timing comparisons certain, yet the cycle stays open.
        assertEq(known & 6, 6);
        uint8 knownBeforeClose = known;
        uint8 valuesBeforeClose = values;
        game.closeCycle();
        uint8 finalValues;
        (open, final_, known, finalValues) = source.outcomeState(1);
        assertFalse(open);
        assertTrue(final_);
        assertEq(known, 0xff);
        assertEq(finalValues & knownBeforeClose, valuesBeforeClose);
        (open, final_, known, values) = source.outcomeState(2);
        assertTrue(open);
        assertFalse(final_);
        (open, final_, known, values) = source.outcomeState(3);
        assertFalse(open);
        assertFalse(final_);
        assertEq(known, 0);
        assertEq(values, 0);
    }

    function test_faucetAndGameMintPermissions() public {
        vm.expectRevert(LocalCst.Unauthorized.selector);
        cst.mint(alice, 1);
        vm.expectRevert(LocalCst.Unauthorized.selector);
        cst.burn(alice, 1);
        vm.expectRevert(LocalCst.InvalidAmount.selector);
        cst.faucet(0);
        uint256 excessive = cst.MAX_FAUCET_AMOUNT() + 1;
        vm.expectRevert(LocalCst.InvalidAmount.selector);
        cst.faucet(excessive);
        vm.expectRevert(LocalCst.InsufficientAllowance.selector);
        cst.transferFrom(alice, address(this), 1);
    }

    function test_fuzz_liveKnownAnswersNeverReverse(uint32[20] memory gaps, uint256 choices) public {
        _exerciseKnownAnswers(gaps, choices);
    }

    function test_twentyImmediateCstGesturesRemainCoveredByTheFuzzHarness() public {
        uint32[20] memory gaps;
        _exerciseKnownAnswers(gaps, type(uint256).max);
    }

    function _exerciseKnownAnswers(uint32[20] memory gaps, uint256 choices) private {
        // Twenty immediate CST gestures can burn over 400 million CST. Fund that
        // adversarial path explicitly instead of rejecting it or assuming slow prices.
        deal(address(cst), alice, 1_000_000_000 ether, true);
        _eth();
        uint8 previousKnown;
        uint8 previousValues;
        for (uint256 i; i < gaps.length; ++i) {
            vm.warp(block.timestamp + bound(gaps[i], 0, 300));
            if ((choices >> i) & 1 != 0) {
                vm.prank(alice);
                game.bidCst(type(uint256).max);
            } else {
                _eth();
            }
            (,, uint8 known, uint8 values) = source.outcomeState(1);
            assertEq(known & previousKnown, previousKnown);
            assertEq(values & previousKnown, previousValues & previousKnown);
            previousKnown = known;
            previousValues = values;
        }
        vm.warp(game.mainPrizeTime() > block.timestamp ? game.mainPrizeTime() : block.timestamp);
        vm.prank(alice);
        game.closeCycle();
        (,, uint8 mask, uint8 result) = source.outcomeState(1);
        assertEq(mask, 255);
        assertEq(result & previousKnown, previousValues & previousKnown);
    }

    function _exerciseParity(uint256 gestures, uint256 choices, uint32[40] memory gaps) private {
        // Each CST gesture at most doubles the next opening price, so this funds
        // every mix, including back-to-back CST gestures at full price.
        deal(address(cst), alice, game.cstOpeningPrice() << gestures, true);
        for (uint256 i; i < gestures; ++i) {
            vm.warp(vm.getBlockTimestamp() + bound(gaps[i], 0, 300));
            if (i != 0 && (choices >> i) & 1 != 0) {
                vm.prank(alice);
                game.bidCst(type(uint256).max);
            } else {
                _eth();
            }
            assertEq(game.roundStats(1).gestureCount, i + 1);
            _assertParityUnknown();
        }
        assertEq((_closeCycle() >> 5) & 1, gestures % 2);
    }

    function _eth() private {
        uint256 price = game.getNextEthPrice();
        vm.prank(alice);
        game.bidEth{value: price}();
    }

    function _assertParityUnknown() private view {
        (bool open,, uint8 known, uint8 values) = source.outcomeState(1);
        assertTrue(open);
        assertEq(known & 32, 0);
        assertEq(values & 32, 0);
    }

    /// @dev Closes cycle 1 as its last gesturer and returns the finalized answers.
    function _closeCycle() private returns (uint8 values) {
        uint256 prizeTime = game.mainPrizeTime();
        if (prizeTime > vm.getBlockTimestamp()) vm.warp(prizeTime);
        vm.prank(alice);
        game.closeCycle();
        bool open;
        bool final_;
        uint8 mask;
        (open, final_, mask, values) = source.outcomeState(1);
        assertFalse(open);
        assertTrue(final_);
        assertEq(mask, 255);
    }
}

contract ChampionMetricsTest is Test {
    function test_fuzz_matchesIndependentRecordEpisodeModel(uint32[32] memory gaps) public {
        MetricsHarness h = new MetricsHarness();
        uint256[] memory times = new uint256[](gaps.length + 1);
        times[0] = 10_000;
        h.observe(false, 1, times[0]);
        for (uint256 i; i < gaps.length; ++i) {
            times[i + 1] = times[i] + bound(gaps[i], 0, 10 days);
            if (i + 1 < gaps.length) h.observe((i & 1) == 0, i, times[i + 1]);
        }
        uint256 end = times[gaps.length - 1] + bound(gaps[gaps.length - 1], 0, 10 days);
        h.finish(end);
        CycleMetrics.Metrics memory m = h.current(end);
        (uint256 e, uint256 c, uint256 ei, uint256 ci) = _reference(times, gaps.length, end);
        assertEq(m.enduranceDuration, e);
        assertEq(m.chronoDuration, c);
        assertEq(m.enduranceGesture, ei);
        assertEq(m.chronoGesture, ci);
    }

    function test_sameWalletIsNotSameGestureAndLateRecordCanLoseChrono() public {
        MetricsHarness h = new MetricsHarness();
        h.observe(false, 1, 0);
        h.observe(true, 1, 10);
        h.observe(true, 1, 18);
        h.observe(true, 1, 26);
        h.finish(46);
        CycleMetrics.Metrics memory m = h.current(46);
        assertEq(m.enduranceGesture, 4);
        assertEq(m.enduranceDuration, 20);
        assertEq(m.chronoGesture, 1);
        assertEq(m.chronoDuration, 36);
    }

    function test_badObservationOrderAndRepeatFinalizationRevert() public {
        MetricsHarness h = new MetricsHarness();
        vm.expectRevert(CycleMetrics.InvalidObservation.selector);
        h.observe(true, 1, 10);
        h.observe(false, 1, 10);
        vm.expectRevert(CycleMetrics.InvalidObservation.selector);
        h.observe(false, 1, 9);
        h.finish(20);
        vm.expectRevert(CycleMetrics.InvalidObservation.selector);
        h.finish(21);
        vm.expectRevert(CycleMetrics.InvalidObservation.selector);
        h.observe(false, 1, 21);
    }

    /// @dev Independent model: list successive record promotion times, then choose longest tenure.
    function _reference(uint256[] memory times, uint256 n, uint256 end)
        private
        pure
        returns (uint256 e, uint256 c, uint256 ei, uint256 ci)
    {
        uint256 promotion = times[0];
        bool first = true;
        bool haveChrono;
        for (uint256 i; i < n; ++i) {
            uint256 next = i + 1 < n ? times[i + 1] : end;
            uint256 gap = next - times[i];
            if (first) {
                e = gap;
                ei = i + 1;
                first = false;
            } else if (gap > e) {
                uint256 newPromotion = times[i] + e;
                uint256 tenure = newPromotion - promotion;
                if (!haveChrono || tenure > c) {
                    c = tenure;
                    ci = ei;
                    haveChrono = true;
                }
                promotion = newPromotion;
                e = gap;
                ei = i + 1;
            }
        }
        uint256 lastTenure = end - promotion;
        if (!haveChrono || lastTenure > c) {
            c = lastTenure;
            ci = ei;
        }
    }
}
