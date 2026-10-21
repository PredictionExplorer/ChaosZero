// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IOutcomeSource} from "./IOutcomeSource.sol";

/// @notice Immutable answers for eight independent binary markets.
/// @dev Settlement uses finalized answers only; no historical timestamps or prices are required.
interface IIndependentOutcomeSource is IOutcomeSource {
    struct Metrics {
        uint256 gestureCount;
        uint256 ethSpent;
        uint256 cstBurned;
        uint256 highestCstPaid;
        uint256 enduranceDuration;
        uint256 chronoDuration;
        bool sameGesture;
        bool finalized;
        bool supported;
    }
}
