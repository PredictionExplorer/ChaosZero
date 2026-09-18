// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @notice Chronological cycle accounting used by the local game and its objective outcome source.
/// @dev Champion timing follows Cosmic Signature's BidStatisticsV2, including strict record ties
/// and the promotion instant (gesture time + the preceding endurance record). Gesture identities,
/// rather than addresses, distinguish separate performances by the same wallet.
library CycleMetrics {
    struct Metrics {
        uint256 gestureCount;
        uint256 ethGestureCount;
        uint256 cstGestureCount;
        uint256 ethSpent;
        uint256 cstBurned;
        uint256 highestCstPaid;
        uint256 enduranceDuration;
        uint256 chronoDuration;
        uint256 enduranceGesture;
        uint256 chronoGesture;
        uint256 enduranceStart;
        uint256 previousEnduranceDuration;
        uint256 firstGestureTime;
        uint256 lastGestureTime;
        bool chronoInitialized;
        bool finalized;
    }

    error InvalidObservation();

    function observe(Metrics storage stored, bool withCst, uint256 paid, uint256 timestamp) internal {
        if (stored.finalized || (stored.gestureCount != 0 && timestamp < stored.lastGestureTime)) {
            revert InvalidObservation();
        }
        Metrics memory next = stored;
        if (next.gestureCount == 0) {
            if (withCst) revert InvalidObservation();
            next.firstGestureTime = timestamp;
        } else {
            _updateEndurance(next, timestamp);
        }
        ++next.gestureCount;
        next.lastGestureTime = timestamp;
        if (withCst) {
            ++next.cstGestureCount;
            next.cstBurned += paid;
            if (paid > next.highestCstPaid) next.highestCstPaid = paid;
        } else {
            ++next.ethGestureCount;
            next.ethSpent += paid;
        }
        _store(stored, next);
    }

    function finish(Metrics storage stored, uint256 timestamp) internal {
        if (stored.gestureCount == 0 || stored.finalized || timestamp < stored.lastGestureTime) {
            revert InvalidObservation();
        }
        Metrics memory next = current(stored, timestamp);
        next.finalized = true;
        _store(stored, next);
    }

    function current(Metrics storage stored, uint256 timestamp) internal view returns (Metrics memory next) {
        next = stored;
        if (next.finalized || next.gestureCount == 0) return next;
        if (timestamp < next.lastGestureTime) revert InvalidObservation();
        _updateEndurance(next, timestamp);
        _updateChrono(next, timestamp);
    }

    function _updateEndurance(Metrics memory m, uint256 timestamp) private pure {
        uint256 gap = timestamp - m.lastGestureTime;
        if (m.enduranceGesture == 0) {
            m.enduranceGesture = m.gestureCount;
            m.enduranceStart = m.lastGestureTime;
            m.enduranceDuration = gap;
        } else if (gap > m.enduranceDuration) {
            _updateChrono(m, m.lastGestureTime + m.enduranceDuration);
            m.previousEnduranceDuration = m.enduranceDuration;
            m.enduranceGesture = m.gestureCount;
            m.enduranceStart = m.lastGestureTime;
            m.enduranceDuration = gap;
        }
    }

    function _updateChrono(Metrics memory m, uint256 timestamp) private pure {
        uint256 tenure = timestamp - (m.enduranceStart + m.previousEnduranceDuration);
        if (!m.chronoInitialized || tenure > m.chronoDuration) {
            m.chronoInitialized = true;
            m.chronoDuration = tenure;
            m.chronoGesture = m.enduranceGesture;
        }
    }

    function _store(Metrics storage target, Metrics memory value) private {
        target.gestureCount = value.gestureCount;
        target.ethGestureCount = value.ethGestureCount;
        target.cstGestureCount = value.cstGestureCount;
        target.ethSpent = value.ethSpent;
        target.cstBurned = value.cstBurned;
        target.highestCstPaid = value.highestCstPaid;
        target.enduranceDuration = value.enduranceDuration;
        target.chronoDuration = value.chronoDuration;
        target.enduranceGesture = value.enduranceGesture;
        target.chronoGesture = value.chronoGesture;
        target.enduranceStart = value.enduranceStart;
        target.previousEnduranceDuration = value.previousEnduranceDuration;
        target.firstGestureTime = value.firstGestureTime;
        target.lastGestureTime = value.lastGestureTime;
        target.chronoInitialized = value.chronoInitialized;
        target.finalized = value.finalized;
    }
}
