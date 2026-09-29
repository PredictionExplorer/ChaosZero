// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IOutcomeSource} from "./IOutcomeSource.sol";

/// @notice Canonical game timestamps for retrospective price sampling.
/// @dev Times must come from game actions, never the caller's settlement time.
interface IIndependentOutcomeSource is IOutcomeSource {
    /// @dev `finalizedAt` is the block timestamp of the round-ending transaction
    /// (`claimMainPrize` on the live game, `closeCycle` locally), never `mainPrizeTime`
    /// or the time of a later market call. `firstGestureAt` is the canonical first gesture.
    function cycleTimes(uint256 roundId) external view returns (uint256 firstGestureAt, uint256 finalizedAt);
}
