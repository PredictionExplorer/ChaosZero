// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IIndependentOutcomeSource} from "./interfaces/IIndependentOutcomeSource.sol";
import {ICosmicGameV3} from "./interfaces/ICosmicGameV3.sol";

/// @notice Eight recurring answers from Cosmic Signature V3, with a frozen historical launch baseline.
/// @dev V2 did not retain five of the six comparative statistics. Those launch inputs
/// must be independently reconstructed and verified before deployment: validating the
/// native gesture count is not an on-chain proof of the other historical inputs.
/// Later cycles use only V3's permanent records. The game is an upgradeable proxy;
/// this source has no administrator, result setter, or replacement mechanism.
contract V3OutcomeSource is IIndependentOutcomeSource {
    struct HistoricalBaseline {
        uint256 gestureCount;
        uint256 ethSpent;
        uint256 cstBurned;
        uint256 highestCstPaid;
        uint256 enduranceDuration;
        uint256 chronoDuration;
        bool sameGesture;
    }

    ICosmicGameV3 public immutable game;
    address public immutable cst;
    uint256 public immutable firstMarketRound;
    bytes32 public immutable baselineHash;
    /// @dev Written only in the constructor; no mutation path exists.
    HistoricalBaseline public baseline;

    error InvalidConfiguration();
    error InvalidGameState();

    constructor(ICosmicGameV3 game_, uint256 firstMarketRound_, HistoricalBaseline memory baseline_) {
        if (address(game_).code.length == 0 || firstMarketRound_ == 0) revert InvalidConfiguration();
        address token = game_.token();
        uint256 current = game_.roundNum();
        if (token.code.length == 0 || current < firstMarketRound_) revert InvalidConfiguration();
        ICosmicGameV3.RoundStats memory previous = game_.roundStats(firstMarketRound_ - 1);
        // Decode the complete V3 getter for both current and baseline rounds. A
        // legacy contract with an incompatible getter cannot satisfy this ABI.
        _validate(game_.roundStats(current), false);
        if (
            baseline_.gestureCount == 0 || baseline_.gestureCount != previous.numBids || baseline_.ethSpent == 0
                || baseline_.highestCstPaid > baseline_.cstBurned
        ) revert InvalidConfiguration();
        // If native V3 history exists, supplied data must agree with every field.
        if (previous.totalSpentEthAmount != 0) {
            if (
                baseline_.ethSpent != previous.totalSpentEthAmount
                    || baseline_.cstBurned != previous.totalSpentCstAmount
                    || baseline_.highestCstPaid != previous.maxCstBidPrice
                    || baseline_.enduranceDuration != previous.enduranceChampionDuration
                    || baseline_.chronoDuration != previous.chronoWarriorDuration
                    || baseline_.sameGesture != ((previous.flags & 4) != 0)
            ) revert InvalidConfiguration();
        }
        game = game_;
        cst = token;
        firstMarketRound = firstMarketRound_;
        baseline = baseline_;
        baselineHash = keccak256(abi.encode(address(game_), firstMarketRound_ - 1, baseline_));
    }

    /// @notice Current statistics or permanently finalized statistics, with explicit availability.
    /// @dev `sameGesture` is meaningful only after finalization. Unsupported older or
    /// future cycles return `supported=false`; zero is never invented as a historical baseline.
    function metrics(uint256 roundId) external view returns (Metrics memory) {
        return _metrics(roundId, _currentRound());
    }

    function outcomeState(uint256 roundId)
        external
        view
        returns (bool open, bool finalized, uint8 knownMask, uint8 values)
    {
        uint256 current = _currentRound();
        if (roundId < firstMarketRound || roundId > current) return (false, false, 0, 0);
        Metrics memory previous = _metrics(roundId - 1, current);
        if (!previous.supported || !previous.finalized) return (false, false, 0, 0);
        Metrics memory now_ = _metrics(roundId, current);
        if (!now_.supported) return (false, false, 0, 0);
        finalized = now_.finalized;
        open = roundId == current;
        if (now_.gestureCount > previous.gestureCount) values |= 1;
        if (now_.enduranceDuration > previous.enduranceDuration) values |= 2;
        if (now_.chronoDuration > previous.chronoDuration) values |= 4;
        if (now_.ethSpent > previous.ethSpent) values |= 8;
        if (now_.cstBurned > previous.cstBurned) values |= 16;
        if (now_.gestureCount % 2 == 1) values |= 32;
        if (now_.sameGesture) values |= 64;
        if (now_.highestCstPaid > previous.highestCstPaid) values |= 128;
        if (finalized) return (false, true, 255, values);
        // Parity and same-gesture identity can change either way until closure.
        knownMask = values & 0x9f;
        values &= knownMask;
    }

    function _currentRound() private view returns (uint256 current) {
        if (game.token() != cst) revert InvalidGameState();
        current = game.roundNum();
        if (current < firstMarketRound) revert InvalidGameState();
    }

    function _metrics(uint256 roundId, uint256 current) private view returns (Metrics memory result) {
        if (roundId == firstMarketRound - 1) {
            HistoricalBaseline memory b = baseline;
            return Metrics(
                b.gestureCount,
                b.ethSpent,
                b.cstBurned,
                b.highestCstPaid,
                b.enduranceDuration,
                b.chronoDuration,
                b.sameGesture,
                true,
                true
            );
        }
        if (roundId < firstMarketRound || roundId > current) return result;
        ICosmicGameV3.RoundStats memory r = game.roundStats(roundId);
        bool finalized = roundId < current;
        _validate(r, finalized);
        result = Metrics(
            r.numBids,
            r.totalSpentEthAmount,
            r.totalSpentCstAmount,
            r.maxCstBidPrice,
            r.enduranceChampionDuration,
            r.chronoWarriorDuration,
            finalized && (r.flags & 4) != 0,
            finalized,
            true
        );
        if (!finalized && r.numBids != 0) {
            (, result.enduranceDuration,, result.chronoDuration) = game.tryGetCurrentChampions();
        }
    }

    function _validate(ICosmicGameV3.RoundStats memory r, bool finalized) private pure {
        if (
            r.numCstBids > r.numBids || r.maxCstBidPrice > r.totalSpentCstAmount
                || r.maxEthBidPrice > r.totalSpentEthAmount
                || (r.numBids == 0 && (r.totalSpentEthAmount != 0 || r.totalSpentCstAmount != 0))
                || (r.numBids != 0 && r.totalSpentEthAmount == 0) || (finalized && r.numBids == 0)
        ) revert InvalidGameState();
    }
}
