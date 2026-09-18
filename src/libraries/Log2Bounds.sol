// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @notice Rigorous enclosing bounds for log2(x), in unsigned Q64 units.
/// @dev No empirical error allowance is used. The exact normalized value starts
/// inside [lo, hi] in Q127. Independent squaring trajectories round the lower
/// value down and the upper value up, including normalization by two. If d is
/// that trajectory's extracted bit and z its normalized next value, then
/// log2(oldLo/Q) >= (dLo + log2(zLo/Q))/2, and the upper inequality reverses.
/// Telescoping 64 steps and bounding the final logarithm in [0,1) proves
/// lower <= log2(x)*2^64 <= upper. Different trajectories may extract different
/// bits; that is intentional and avoids a wide interval near a bit boundary.
/// Products need not fit a word: summing lower(new) >= sum upper(old) proves
/// product(new) >= product(old), by monotonicity of log2 and exponentiation.
library Log2Bounds {
    uint256 internal constant MAX_INPUT = 1 << 120;
    uint256 private constant Q = 1 << 127;
    uint256 private constant TWO_Q = 1 << 128;
    uint256 private constant MASK = Q - 1;

    error InvalidLogInput();

    function bounds(uint256 x) internal pure returns (uint256 lower, uint256 upper) {
        if (x == 0 || x > MAX_INPUT) revert InvalidLogInput();
        uint256 e = mostSignificantBit(x);
        lower = e << 64;
        if ((x & (x - 1)) == 0) return (lower, lower);
        // x has at most 121 bits, so normalization is an exact left shift.
        uint256 lo = x << (127 - e);
        uint256 hi = lo;
        upper = lower;
        uint256 bit = 1 << 63;
        unchecked {
            while (bit != 0) {
                // lo,hi < 2^128: even upward rounding followed by normalization
                // remains <2^128. Thus these full squares fit uint256 exactly.
                uint256 loSquare = lo * lo;
                uint256 hiSquare = hi * hi;
                lo = loSquare >> 127;
                hi = (hiSquare >> 127) + ((hiSquare & MASK) == 0 ? 0 : 1);
                if (lo >= TWO_Q) {
                    lower += bit;
                    lo >>= 1;
                }
                if (hi >= TWO_Q) {
                    upper += bit;
                    hi = (hi >> 1) + (hi & 1);
                }
                bit >>= 1;
            }
        }
        if (hi != Q) ++upper;
    }

    function mostSignificantBit(uint256 x) internal pure returns (uint256 r) {
        if (x >= 1 << 128) {
            x >>= 128;
            r += 128;
        }
        if (x >= 1 << 64) {
            x >>= 64;
            r += 64;
        }
        if (x >= 1 << 32) {
            x >>= 32;
            r += 32;
        }
        if (x >= 1 << 16) {
            x >>= 16;
            r += 16;
        }
        if (x >= 1 << 8) {
            x >>= 8;
            r += 8;
        }
        if (x >= 1 << 4) {
            x >>= 4;
            r += 4;
        }
        if (x >= 1 << 2) {
            x >>= 2;
            r += 2;
        }
        if (x >= 1 << 1) r += 1;
    }
}
