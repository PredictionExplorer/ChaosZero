// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IIndependentOutcomeSource} from "../interfaces/IIndependentOutcomeSource.sol";
import {LocalCosmicGame} from "./LocalCosmicGame.sol";
import {CycleMetrics} from "./CycleMetrics.sol";

/// @notice Objective adapter for the local simulator. Deliberately impossible to deploy on a live chain.
/// @dev Production requires authenticated historical game data, not an administrator supplying answers.
/// `open = !finalized && roundId == game.roundNum()` derives solely from the round counter: the
/// early YES answers for questions 0-4 and 7 in `knownMask` never affect `open`, and neither does
/// the countdown. `LocalCosmicGame.closeCycle` is the local counterpart of `claimMainPrize` and
/// flips `open` to false and `finalized` to true atomically.
contract LocalOutcomeSource is IIndependentOutcomeSource {
    LocalCosmicGame public immutable game;
    error LocalChainOnly();
    error InvalidGame();

    constructor(LocalCosmicGame game_) {
        if (block.chainid != 31337) revert LocalChainOnly();
        if (address(game_).code.length == 0) revert InvalidGame();
        game = game_;
    }

    function metrics(uint256 roundId) external view returns (Metrics memory result) {
        if (roundId > game.roundNum()) return result;
        CycleMetrics.Metrics memory m = game.roundStats(roundId);
        return Metrics(
            m.gestureCount,
            m.ethSpent,
            m.cstBurned,
            m.highestCstPaid,
            m.enduranceDuration,
            m.chronoDuration,
            m.finalized && m.enduranceGesture != 0 && m.enduranceGesture == m.chronoGesture,
            m.finalized,
            true
        );
    }

    function outcomeState(uint256 roundId)
        external
        view
        returns (bool open, bool finalized, uint8 knownMask, uint8 values)
    {
        if (roundId == 0 || roundId > game.roundNum()) return (false, false, 0, 0);
        CycleMetrics.Metrics memory previous = game.roundStats(roundId - 1);
        if (!previous.finalized) return (false, false, 0, 0);
        CycleMetrics.Metrics memory now_ = game.roundStats(roundId);
        finalized = now_.finalized;
        open = !finalized && roundId == game.roundNum();
        if (now_.gestureCount > previous.gestureCount) values |= 1;
        if (now_.enduranceDuration > previous.enduranceDuration) values |= 2;
        if (now_.chronoDuration > previous.chronoDuration) values |= 4;
        if (now_.ethSpent > previous.ethSpent) values |= 8;
        if (now_.cstBurned > previous.cstBurned) values |= 16;
        if (now_.gestureCount % 2 == 1) values |= 32;
        if (now_.enduranceGesture != 0 && now_.enduranceGesture == now_.chronoGesture) values |= 64;
        if (now_.highestCstPaid > previous.highestCstPaid) values |= 128;
        if (finalized) return (false, true, type(uint8).max, values);
        // Question 5 flips with every gesture and question 6 can change either way, so both are
        // known only at closure. The other six only grow.
        knownMask = values & 0x9f;
        values &= knownMask;
    }
}
