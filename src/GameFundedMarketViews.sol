// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {IndependentOutcomeMarket} from "./IndependentOutcomeMarket.sol";
import {BinaryMarketMath} from "./libraries/BinaryMarketMath.sol";

/// @notice Stateless read helper for the game-funded market.
/// @dev Position reads, product verification and metadata use the previous eight-question
/// market's ABI and rules. Funding is always quoted by the supplied market itself.
contract GameFundedMarketViews {
    /// @dev Pure invariant proof is shared by buy/sell without inflating engine bytecode.
    function verifyProduct(
        uint256 beforeC,
        uint256 beforeY,
        uint256 beforeN,
        uint256 afterC,
        uint256 afterY,
        uint256 afterN,
        uint16 initialYesBps
    ) external pure {
        BinaryMarketMath.verifyProduct(beforeC, beforeY, beforeN, afterC, afterY, afterN, initialYesBps);
    }

    /// @dev Forwarded batch getters: identical ABI output, no market bytecode.
    function questionStates(IndependentOutcomeMarket market, uint256 roundId)
        external
        view
        returns (IndependentOutcomeMarket.QuestionView[8] memory result)
    {
        for (uint8 q; q < 8; ++q) {
            result[q] = market.questionState(roundId, q);
        }
    }

    function balancesOf(IndependentOutcomeMarket market, uint256 roundId, address user)
        public
        view
        returns (uint256[8] memory yes, uint256[8] memory no)
    {
        for (uint8 q; q < 8; ++q) {
            yes[q] = market.balanceOf(user, market.positionId(roundId, q, true));
            no[q] = market.balanceOf(user, market.positionId(roundId, q, false));
        }
    }

    function previewSettlement(IndependentOutcomeMarket market, uint256 roundId)
        external
        view
        returns (bool ready, uint256 escrowed, uint256 carried)
    {
        return _settlement(market, roundId);
    }

    function previewClaim(IndependentOutcomeMarket market, uint256 roundId, address user)
        external
        view
        returns (bool claimable, uint256 total, uint256[8] memory amounts)
    {
        IndependentOutcomeMarket.RoundView memory r = market.roundState(roundId);
        if (!r.initialized) return (false, 0, amounts);
        uint8 values = r.values;
        if (!r.settled) {
            (, bool finalized,, uint8 observed) = _source(market, roundId, r);
            if (!finalized) return (false, 0, amounts);
            values = observed;
        }
        (uint256[8] memory y, uint256[8] memory n) = balancesOf(market, roundId, user);
        for (uint8 q; q < 8; ++q) {
            amounts[q] = (values & (uint8(1) << q)) != 0 ? y[q] : n[q];
            total += amounts[q];
        }
        return (true, total, amounts);
    }

    function _settlement(IndependentOutcomeMarket market, uint256 roundId)
        private
        view
        returns (bool ready, uint256 escrowed, uint256 carried)
    {
        IndependentOutcomeMarket.RoundView memory r = market.roundState(roundId);
        if (!r.initialized) return (false, 0, 0);
        if (r.settled) return (true, 0, 0);
        (, bool finalized,, uint8 values) = _source(market, roundId, r);
        if (!finalized) return (false, 0, 0);
        for (uint8 q; q < 8; ++q) {
            IndependentOutcomeMarket.QuestionView memory p = market.questionState(roundId, q);
            uint256 owed = (values & (uint8(1) << q)) != 0 ? p.yesSupply : p.noSupply;
            escrowed += owed;
            carried += p.activeCollateral - owed;
        }
        return (true, escrowed, carried);
    }

    function _source(IndependentOutcomeMarket market, uint256 roundId, IndependentOutcomeMarket.RoundView memory r)
        private
        view
        returns (bool open, bool finalized, uint8 known, uint8 values)
    {
        (open, finalized, known, values) = market.source().outcomeState(roundId);
        if (
            (values & ~known) != 0 || (known & r.knownMask) != r.knownMask || ((values ^ r.values) & r.knownMask) != 0
                || (r.closed && open) || (r.finalized && !finalized)
                || (finalized && (open || known != type(uint8).max))
        ) revert IndependentOutcomeMarket.InvalidSourceState();
    }

    function fundingPreview(IndependentOutcomeMarket market, uint256 roundId, uint256 newAmount)
        external
        view
        returns (IndependentOutcomeMarket.FundingPreview memory)
    {
        return market.fundingPreview(roundId, newAmount);
    }

    function uri(uint256 id, address outcomeSource) external pure returns (string memory) {
        uint256 round = id >> 4;
        uint256 q = (id >> 1) & 7;
        bool yes = (id & 1) != 0;
        bytes memory json = abi.encodePacked(
            '{"name":"Chaos Zero cycle ',
            Strings.toString(round),
            " question ",
            Strings.toString(uint256(q) + 1),
            yes ? " YES" : " NO",
            '","description":"Independent binary CST position. Winning units and matched same-question pairs redeem 1:1.",',
            '"decimals":18,"properties":{"round":"',
            Strings.toString(round),
            '","question":',
            Strings.toString(q),
            ',"side":"',
            yes ? "YES" : "NO",
            '","outcomeSource":"',
            Strings.toHexString(outcomeSource),
            '"}}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(json));
    }
}
