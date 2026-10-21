// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @notice The immutable, objective source of all eight answers for a cycle.
interface IOutcomeSource {
    /// @dev Bit i of `values` is meaningful only when bit i of `knownMask` is set;
    /// unknown value bits must be zero. Once a funded cycle closes it cannot reopen.
    /// Known answers must never change. Finalized cycles must have all eight answers.
    /// `open` authorizes sponsorship and trading; it must be false for ended cycles.
    ///
    /// Markets never end early. `open` MUST be true for the game's current round, derived
    /// from the game's round counter (`roundNum`), from the moment every earlier round is
    /// finalized until the game's round-ending transaction (`claimMainPrize` on the live
    /// game) advances that counter, regardless of how many answers are known (even
    /// `knownMask == 0xff`), whether `mainPrizeTime` has passed, or whether the claim
    /// timeout has elapsed. `finalized` MUST become true, with `knownMask == 0xff`, in that
    /// same transaction, at which point `open` becomes false; a round may never be reported
    /// not-open-and-not-finalized once it has become current. A round may be open only
    /// after every earlier round is finalized (the market settles the previous funded round
    /// on first funding). Known answers never change, never close
    /// trading and never authorize payout; payout waits for `finalized`.
    function outcomeState(uint256 roundId)
        external
        view
        returns (bool open, bool finalized, uint8 knownMask, uint8 values);
}
