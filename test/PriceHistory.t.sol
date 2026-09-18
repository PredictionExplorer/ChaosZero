// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {PriceHistory} from "../src/libraries/PriceHistory.sol";

contract PriceHistoryHarness {
    using PriceHistory for PriceHistory.Data;
    PriceHistory.Data private _history;

    function observe(uint64 timestamp, uint16 price) external {
        _history.observe(timestamp, price);
    }

    function average(uint64 start, uint64 end, uint16 fallbackPrice) external view returns (uint16, bool) {
        return _history.average(start, end, fallbackPrice);
    }

    function count() external view returns (uint256) {
        return _history.checkpoints.length;
    }

    function checkpoint(uint256 index) external view returns (PriceHistory.Checkpoint memory) {
        return _history.checkpoints[index];
    }
}

contract PriceHistoryTest is Test {
    PriceHistoryHarness private history;

    function setUp() public {
        history = new PriceHistoryHarness();
    }

    function test_emptyHistoryUsesTheSuppliedFallback() public view {
        _expectAverage(history, 0, 100, 4321, 4321, false);
    }

    function test_shortCyclesUseTheActualRoundedEndpointWidth() public {
        history.observe(0, 2345);
        _expectAverage(history, 0, 0, 6000, 6000, false);
        _expectAverage(history, 0, 1, 6000, 6000, false);
        _expectAverage(history, 0, 2, 6000, 2345, true); // [0,1)
        _expectAverage(history, 0, 3, 6000, 6000, false); // [1,1)
        _expectAverage(history, 0, 4, 6000, 2345, true); // [1,2)
    }

    function test_middleWindowWeightsElapsedTimeNotObservationCount() public {
        history.observe(0, 1000);
        history.observe(130, 2000);
        history.observe(150, 8000);
        history.observe(170, 9000);
        _expectAverage(history, 100, 200, 6000, 5000, true); // [140,160)
    }

    function test_unequalDurationsAndFractionalMeansRoundDown() public {
        history.observe(0, 2000);
        history.observe(45, 8000);
        _expectAverage(history, 0, 100, 6000, 6500, true); // 5*2000 + 15*8000
        PriceHistoryHarness tiny = new PriceHistoryHarness();
        tiny.observe(0, 1);
        tiny.observe(5, 2);
        _expectAverage(tiny, 0, 10, 6000, 1, true); // 3 / 2 floors to 1.
    }

    function test_exactWindowBoundariesExcludeTheQuoteStartingAtT60() public {
        history.observe(0, 1000);
        history.observe(40, 3333);
        history.observe(60, 9999);
        _expectAverage(history, 0, 100, 6000, 3333, true);
    }

    function test_aQuietIntervalExtrapolatesTheLastRecordedQuote() public {
        history.observe(50, 8765);
        _expectAverage(history, 1000, 2000, 6000, 8765, true);
    }

    function test_fundedAfterCycleStartIsValidWhenTheWholeMiddleWindowIsCovered() public {
        history.observe(30, 3210);
        _expectAverage(history, 0, 100, 6000, 3210, true);
        PriceHistoryHarness exact = new PriceHistoryHarness();
        exact.observe(40, 4567);
        _expectAverage(exact, 0, 100, 6000, 4567, true);
    }

    function test_missingAnyWindowPrefixUsesFallbackWithoutInventingEarlierPrices() public {
        history.observe(41, 9000);
        history.observe(50, 1000);
        _expectAverage(history, 0, 100, 3456, 3456, false);
        _expectAverage(history, 100, 200, 3456, 1000, true);
    }

    function test_recordedZeroAndCertaintyAreNotClampedByTheHistoryLibrary() public {
        history.observe(0, 0);
        _expectAverage(history, 0, 100, 5000, 0, true);
        history.observe(0, 10_000);
        _expectAverage(history, 0, 100, 5000, 10_000, true);
    }

    function test_sameTimestampReplacementPreservesTheEarlierIntegral() public {
        history.observe(0, 1000);
        history.observe(50, 9000);
        history.observe(50, 7000);
        assertEq(history.count(), 2);
        PriceHistory.Checkpoint memory last = history.checkpoint(1);
        assertEq(last.timestamp, 50);
        assertEq(last.cumulative, 50_000);
        assertEq(last.price, 7000);
        _expectAverage(history, 0, 80, 6000, 1000, true); // [32,48) is unchanged.
        _expectAverage(history, 0, 100, 6000, 4000, true);
    }

    function test_denseSameBlockUpdatesUseOnlyTheFinalQuoteGoingForward() public {
        for (uint16 price; price <= 10_000; price += 100) {
            history.observe(100, price);
        }
        assertEq(history.count(), 1);
        assertEq(history.checkpoint(0).cumulative, 0);
        history.observe(110, 1234);
        assertEq(history.checkpoint(1).cumulative, 100_000);
        _expectAverage(history, 100, 110, 6000, 10_000, true);
    }

    function test_backwardsTimeAndInvalidPricesLeaveTheTailIntact() public {
        history.observe(100, 2500);
        history.observe(200, 7500);
        vm.expectRevert(abi.encodeWithSelector(PriceHistory.TimestampOutOfOrder.selector, uint64(200), uint64(199)));
        history.observe(199, 5000);
        vm.expectRevert(abi.encodeWithSelector(PriceHistory.InvalidPrice.selector, uint16(10_001)));
        history.observe(200, 10_001);
        assertEq(history.count(), 2);
        PriceHistory.Checkpoint memory last = history.checkpoint(1);
        assertEq(last.timestamp, 200);
        assertEq(last.price, 7500);
        assertEq(last.cumulative, 250_000);
    }

    function test_reversedIntervalsAndInvalidFallbacksAreRejected() public {
        vm.expectRevert(abi.encodeWithSelector(PriceHistory.InvalidInterval.selector, uint64(2), uint64(1)));
        history.average(2, 1, 5000);
        vm.expectRevert(abi.encodeWithSelector(PriceHistory.InvalidPrice.selector, uint16(10_001)));
        history.average(0, 100, 10_001);
    }

    function test_fullUint64TimespanFitsCumulativeAndEndpointArithmetic() public {
        uint64 maximum = type(uint64).max;
        history.observe(0, 10_000);
        history.observe(maximum, 0);
        assertEq(history.checkpoint(1).cumulative, uint256(maximum) * 10_000);
        _expectAverage(history, 0, maximum, 5000, 10_000, true);
        _expectAverage(history, maximum - 4, maximum, 5000, 10_000, true);
    }

    function test_nonzeroStartNearUint64MaximumDoesNotOverflowMidpoints() public {
        uint64 maximum = type(uint64).max;
        history.observe(maximum - 100, 5000);
        history.observe(maximum - 50, 8000);
        _expectAverage(history, maximum - 100, maximum, 6000, 6500, true);
    }

    function test_fullWidthTimelineKeepsOneSecondRoundingWithoutFloatingPointLoss() public {
        uint64 maximum = type(uint64).max;
        history.observe(0, 10_000);
        history.observe(maximum / 2, 0);
        // The middle window is odd-sized. Its high-price half is one second
        // shorter, so the exact mean is just below 5000 and must floor to 4999.
        _expectAverage(history, 0, maximum, 6000, 4999, true);
    }

    function test_timestampAbiRejectsOverflowRatherThanSilentlyTruncating() public {
        (bool accepted,) = address(history)
            .call(abi.encodeWithSelector(history.observe.selector, uint256(type(uint64).max) + 1, uint16(5000)));
        assertFalse(accepted);
        assertEq(history.count(), 0);
    }

    function test_eachCheckpointOccupiesOneStorageWord() public {
        history.observe(100, 2500);
        history.observe(130, 5000);
        uint256 first = uint256(keccak256(abi.encode(uint256(0))));
        assertEq(uint256(vm.load(address(history), bytes32(first))), (uint256(100) << 128) | (uint256(2500) << 192));
        assertEq(
            uint256(vm.load(address(history), bytes32(first + 1))),
            uint256(75_000) | (uint256(130) << 128) | (uint256(5000) << 192)
        );
    }

    function test_readingOldAndFutureWindowsDoesNotMutateHistory() public {
        history.observe(20, 1234);
        history.observe(80, 8765);
        bytes32 before_ = keccak256(abi.encode(history.checkpoint(0), history.checkpoint(1)));
        history.average(0, 10, 6000);
        history.average(0, 100, 6000);
        history.average(1000, 2000, 6000);
        assertEq(history.count(), 2);
        assertEq(keccak256(abi.encode(history.checkpoint(0), history.checkpoint(1))), before_);
    }

    function test_denseHistoryQueriesStayBelowAColdStorageGasBudget() public {
        uint256 length = 4096;
        for (uint256 i; i < length; ++i) {
            history.observe(uint64(i), uint16(i % 10_001));
        }
        uint256 first = uint256(keccak256(abi.encode(uint256(0))));
        vm.coolSlot(address(history), bytes32(uint256(0)));
        for (uint256 i; i < length; ++i) {
            vm.coolSlot(address(history), bytes32(first + i));
        }
        vm.cool(address(history));
        uint256 beforeGas = gasleft();
        (uint16 value, bool used) = history.average(0, uint64(length), 5000);
        uint256 usedGas = beforeGas - gasleft();
        // t40=1638, t60=2457; one-second prices 1638..2456 average exactly 2047.
        assertTrue(used);
        assertEq(value, 2047);
        emit log_named_uint("4096-checkpoint cold average gas", usedGas);
        assertLt(usedGas, 100_000, "history lookup must not scan the interval");
    }

    function testFuzz_matchesAnIndependentPiecewiseIntegral(
        uint16[24] memory rawPrices,
        uint32[24] memory gaps,
        uint64 rawBase,
        uint32 rawDuration,
        uint8 countSeed,
        uint16 fallbackSeed
    ) public {
        uint256 count = 1 + uint256(countSeed) % 24;
        uint64 base = uint64(bound(rawBase, 0, uint256(type(uint64).max) - 30_000));
        uint64[] memory times = new uint64[](count);
        uint16[] memory prices = new uint16[](count);
        uint64 timestamp = base;
        uint16 smallest = 10_000;
        uint16 largest;
        for (uint256 i; i < count; ++i) {
            timestamp += uint64(gaps[i] % 1001);
            times[i] = timestamp;
            prices[i] = rawPrices[i] % 10_001;
            if (prices[i] < smallest) smallest = prices[i];
            if (prices[i] > largest) largest = prices[i];
            history.observe(timestamp, prices[i]);
        }
        uint64 end = base + uint64(rawDuration % 30_001);
        uint16 fallbackPrice = fallbackSeed % 10_001;
        (uint16 expected, bool covered) = _piecewiseReference(times, prices, base, end, fallbackPrice);
        (uint16 actual, bool used) = history.average(base, end, fallbackPrice);
        assertEq(actual, expected);
        assertEq(used, covered);
        if (used) {
            assertGe(actual, smallest);
            assertLe(actual, largest);
        }
        uint128 previousArea;
        uint64 previousTime;
        for (uint256 i; i < history.count(); ++i) {
            PriceHistory.Checkpoint memory point = history.checkpoint(i);
            assertGe(point.cumulative, previousArea);
            if (i != 0) assertGt(point.timestamp, previousTime);
            assertLe(uint256(point.cumulative), uint256(point.timestamp - times[0]) * 10_000);
            previousArea = point.cumulative;
            previousTime = point.timestamp;
        }
    }

    function testFuzz_constantRecordedPriceIsIndependentOfClockOrigin(
        uint64 rawStart,
        uint32 rawDuration,
        uint16 rawPrice
    ) public {
        uint64 start = uint64(bound(rawStart, 0, uint256(type(uint64).max) - 50_005));
        uint64 duration = 5 + uint64(rawDuration % 50_001);
        uint16 price = rawPrice % 10_001;
        history.observe(start, price);
        _expectAverage(history, start, start + duration, 5000, price, true);
    }

    function testFuzz_translatingAnEntireTimelinePreservesItsAverage(uint64 rawShift, uint16 a, uint16 b, uint16 c)
        public
    {
        uint64 shift = uint64(bound(rawShift, 0, uint256(type(uint64).max) - 100));
        PriceHistoryHarness translated = new PriceHistoryHarness();
        history.observe(0, a % 10_001);
        history.observe(37, b % 10_001);
        history.observe(53, c % 10_001);
        translated.observe(shift, a % 10_001);
        translated.observe(shift + 37, b % 10_001);
        translated.observe(shift + 53, c % 10_001);
        (uint16 expected,) = history.average(0, 100, 5000);
        _expectAverage(translated, shift, shift + 100, 5000, expected, true);
    }

    function testFuzz_redundantSamePriceObservationCannotChangeTheMean(uint16 first, uint16 second, uint8 rawTime)
        public
    {
        PriceHistoryHarness sparse = new PriceHistoryHarness();
        uint16 a = first % 10_001;
        uint16 b = second % 10_001;
        sparse.observe(0, a);
        sparse.observe(100, b);
        history.observe(0, a);
        history.observe(1 + uint64(rawTime % 99), a);
        history.observe(100, b);
        (uint16 expected,) = sparse.average(0, 200, 5000);
        _expectAverage(history, 0, 200, 5000, expected, true);
    }

    function testFuzz_sameTimeCoalescingMatchesOnlyRecordingTheLastQuote(uint16 oldPrice, uint16 newPrice) public {
        PriceHistoryHarness once = new PriceHistoryHarness();
        history.observe(0, oldPrice % 10_001);
        history.observe(0, newPrice % 10_001);
        once.observe(0, newPrice % 10_001);
        assertEq(history.count(), once.count());
        (uint16 expected,) = once.average(0, 100, 5000);
        _expectAverage(history, 0, 100, 5000, expected, true);
    }

    function testFuzz_laterObservationsCannotRewriteAnEarlierWindow(uint64 rawTime, uint16 oldPrice, uint16 laterPrice)
        public
    {
        uint16 price = oldPrice % 10_001;
        history.observe(0, price);
        uint64 timestamp = uint64(bound(rawTime, 60, type(uint64).max));
        history.observe(timestamp, laterPrice % 10_001);
        _expectAverage(history, 0, 100, 5000, price, true);
    }

    /// @dev Independent oracle: intersect every piecewise-constant segment with
    /// [t40,t60), sum its rectangle area, then divide once. No cumulative array
    /// or binary lookup is used. Raw duplicate timestamps contribute zero time.
    function _piecewiseReference(
        uint64[] memory times,
        uint16[] memory prices,
        uint64 start,
        uint64 end,
        uint16 fallbackPrice
    ) private pure returns (uint16, bool) {
        uint256 duration = uint256(end) - start;
        uint256 left = uint256(start) + duration * 2 / 5;
        uint256 right = uint256(start) + duration * 3 / 5;
        if (left == right || times.length == 0 || times[0] > left) return (fallbackPrice, false);
        uint256 area;
        for (uint256 i; i < times.length; ++i) {
            uint256 from = times[i] > left ? times[i] : left;
            uint256 until = i + 1 < times.length ? times[i + 1] : right;
            if (until > right) until = right;
            if (until > from) area += uint256(prices[i]) * (until - from);
        }
        return (uint16(area / (right - left)), true);
    }

    function _expectAverage(
        PriceHistoryHarness h,
        uint64 start,
        uint64 end,
        uint16 fallbackPrice,
        uint16 expected,
        bool expectedHistory
    ) private view {
        (uint16 actual, bool used) = h.average(start, end, fallbackPrice);
        assertEq(actual, expected);
        assertEq(used, expectedHistory);
    }
}
