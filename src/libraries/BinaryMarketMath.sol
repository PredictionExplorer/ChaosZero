// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Log2Bounds} from "./Log2Bounds.sol";

/// @notice Weighted binary fixed-product pricing over actual claim backing.
/// @dev With reserves rY=C-Y and rN=C-N and frozen prior p in basis points,
/// the invariant is rY^p * rN^(10000-p). No powers or floating point are used.
/// Positive weights preserve the direction of the rigorous Log2Bounds interval:
/// sum(weight*lower(after)) >= sum(weight*upper(before)) proves non-decrease.
/// Identical reserve factors cancel exactly BEFORE computing bounds. Bounds may
/// conservatively reject a trade near equality; passing always proves the true
/// product cannot decrease. Split/merge pairs leave both reserves unchanged.
library BinaryMarketMath {
    uint256 internal constant MAX_COLLATERAL = 1 << 120;
    uint256 internal constant BPS = 10_000;
    uint16 internal constant MIN_INITIAL_YES_BPS = 1;
    uint16 internal constant MAX_INITIAL_YES_BPS = 9_999;

    error InvalidProbability();
    error InvalidCollateral();
    error NonPositiveReserve();
    error ProductWouldDecrease();

    function verifyProduct(
        uint256 beforeCollateral,
        uint256 beforeYes,
        uint256 beforeNo,
        uint256 afterCollateral,
        uint256 afterYes,
        uint256 afterNo,
        uint16 initialYesBps
    ) internal pure {
        _validateProbability(initialYesBps);
        (uint256 beforeReserveYes, uint256 beforeReserveNo) = _reserves(beforeCollateral, beforeYes, beforeNo);
        (uint256 afterReserveYes, uint256 afterReserveNo) = _reserves(afterCollateral, afterYes, afterNo);
        uint256 upperBefore;
        uint256 lowerAfter;
        if (beforeReserveYes != afterReserveYes) {
            (, uint256 upper) = Log2Bounds.bounds(beforeReserveYes);
            (uint256 lower,) = Log2Bounds.bounds(afterReserveYes);
            upperBefore = uint256(initialYesBps) * upper;
            lowerAfter = uint256(initialYesBps) * lower;
        }
        if (beforeReserveNo != afterReserveNo) {
            (, uint256 upper) = Log2Bounds.bounds(beforeReserveNo);
            (uint256 lower,) = Log2Bounds.bounds(afterReserveNo);
            uint256 noWeight = BPS - initialYesBps;
            upperBefore += noWeight * upper;
            lowerAfter += noWeight * lower;
        }
        // Each log is <=120*2^64, and the positive weights sum to10000.
        // Therefore all weighted sums are below2^85, far below uint256 capacity.
        if (lowerAfter < upperBefore) revert ProductWouldDecrease();
    }

    /// @notice Floor of the current marginal YES probability in basis points.
    /// @dev p*rN/(p*rN+(10000-p)*rY), scaled by10000. Intermediate products
    /// are below2^148 under MAX_COLLATERAL; ordinary checked multiplication is exact.
    /// Returns0 for sufficiently small probabilities; unlike initial priors,
    /// displayed marginal probabilities are not silently clamped.
    function marginalYesBps(uint256 collateral, uint256 yes, uint256 no, uint16 initialYesBps)
        internal
        pure
        returns (uint16)
    {
        _validateProbability(initialYesBps);
        (uint256 reserveYes, uint256 reserveNo) = _reserves(collateral, yes, no);
        uint256 yesNumerator = uint256(initialYesBps) * reserveNo;
        uint256 denominator = yesNumerator + (BPS - initialYesBps) * reserveYes;
        // Both weights and reserves are positive, so the result is in0..9999.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint16(yesNumerator * BPS / denominator);
    }

    function _validateProbability(uint16 p) private pure {
        if (p < MIN_INITIAL_YES_BPS || p > MAX_INITIAL_YES_BPS) revert InvalidProbability();
    }

    function _reserves(uint256 collateral, uint256 yes, uint256 no)
        private
        pure
        returns (uint256 reserveYes, uint256 reserveNo)
    {
        if (collateral == 0 || collateral > MAX_COLLATERAL) revert InvalidCollateral();
        if (yes >= collateral || no >= collateral) revert NonPositiveReserve();
        return (collateral - yes, collateral - no);
    }
}
