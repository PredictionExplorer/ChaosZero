// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @notice Time-weighted history of the last recorded YES quote, in basis points.
/// @dev The recorded quote is constant until the next observation. This does not
/// reconstruct unobserved source changes or assert a continuous fair price.
/// Cumulative units are bps-seconds since the first observation. At most
/// 10_000 * type(uint64).max < 2^78 can accrue, so uint128 cannot overflow.
library PriceHistory {
    struct Checkpoint {
        uint128 cumulative;
        uint64 timestamp;
        uint16 price;
    }

    // Each checkpoint occupies one storage word (128 + 64 + 16 = 208 bits).
    struct Data {
        Checkpoint[] checkpoints;
    }

    error InvalidPrice(uint16 price);
    error TimestampOutOfOrder(uint64 previous, uint64 supplied);
    error InvalidInterval(uint64 start, uint64 end);

    /// @notice Record a quote, replacing the final quote when time has not advanced.
    /// @dev Callers must range-check wider timestamps before converting to uint64.
    /// Replacing a same-time quote never alters the cumulative area before it.
    function observe(Data storage self, uint64 timestamp, uint16 price) internal {
        if (price > 10_000) revert InvalidPrice(price);
        uint256 length = self.checkpoints.length;
        if (length == 0) {
            self.checkpoints.push(Checkpoint(0, timestamp, price));
            return;
        }
        Checkpoint storage last = self.checkpoints[length - 1];
        if (timestamp < last.timestamp) revert TimestampOutOfOrder(last.timestamp, timestamp);
        if (timestamp == last.timestamp) {
            last.price = price;
            return;
        }
        uint128 cumulative = last.cumulative + uint128(last.price) * uint128(timestamp - last.timestamp);
        self.checkpoints.push(Checkpoint(cumulative, timestamp, price));
    }

    /// @notice Floor of the time-weighted YES quote over the cycle's 40–60% window.
    /// @dev Canonical start/end come from the game. Historical data must cover
    /// t40, including an observation exactly at t40; a later first observation
    /// cannot retroactively fill the missing interval. Quiet tails retain the
    /// last recorded quote. The caller, not this library, clamps a next-cycle seed.
    /// Endpoint products use uint256 delta arithmetic, avoiding uint64 overflow.
    function average(Data storage self, uint64 start, uint64 end, uint16 fallbackPrice)
        internal
        view
        returns (uint16 value, bool usedHistory)
    {
        if (fallbackPrice > 10_000) revert InvalidPrice(fallbackPrice);
        if (end < start) revert InvalidInterval(start, end);
        uint256 duration = uint256(end) - uint256(start);
        uint64 t40 = uint64(uint256(start) + duration * 2 / 5);
        uint64 t60 = uint64(uint256(start) + duration * 3 / 5);
        if (t40 == t60 || self.checkpoints.length == 0 || self.checkpoints[0].timestamp > t40) {
            return (fallbackPrice, false);
        }
        uint128 area = _cumulativeAt(self, t60) - _cumulativeAt(self, t40);
        return (uint16(area / uint128(t60 - t40)), true);
    }

    /// @dev Find the final checkpoint at/before timestamp in O(log n). The caller
    /// established that a covering first checkpoint exists. No interval scan is
    /// performed, even when the averaging window contains many observations.
    function _cumulativeAt(Data storage self, uint64 timestamp) private view returns (uint128) {
        uint256 low;
        uint256 high = self.checkpoints.length - 1;
        while (low < high) {
            uint256 middle = low + (high - low + 1) / 2;
            if (self.checkpoints[middle].timestamp <= timestamp) low = middle;
            else high = middle - 1;
        }
        Checkpoint storage point = self.checkpoints[low];
        return point.cumulative + uint128(point.price) * uint128(timestamp - point.timestamp);
    }
}
