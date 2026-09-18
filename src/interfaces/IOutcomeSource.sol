// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @notice The immutable, objective source of all eight answers for a cycle.
interface IOutcomeSource {
    /// @dev Bit i of `values` is meaningful only when bit i of `knownMask` is set;
    /// unknown value bits must be zero. Once a funded cycle closes it cannot reopen.
    /// Known answers must never change. Finalized cycles must have all eight answers.
    /// `open` authorizes sponsorship and trading; it must be false for ended cycles.
    function outcomeState(uint256 roundId)
        external
        view
        returns (bool open, bool finalized, uint8 knownMask, uint8 values);
}
