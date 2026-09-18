// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IOutcomeSource} from "./IOutcomeSource.sol";

/// @notice Canonical game timestamps for retrospective price sampling.
/// @dev Times must come from game actions, never the caller's settlement time.
interface IIndependentOutcomeSource is IOutcomeSource {
    function cycleTimes(uint256 roundId) external view returns (uint256 firstGestureAt, uint256 finalizedAt);
}
