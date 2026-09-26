// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {BinaryMarketMath} from "../src/libraries/BinaryMarketMath.sol";
import {MIN_AUTO_TOP_UP} from "../src/IndependentOutcomeMarket.sol";

/// @dev External calls let the generator record actual library acceptance/reverts.
contract IndependentVectorHarness {
    function verify(
        uint256 beforeC,
        uint256 beforeY,
        uint256 beforeN,
        uint256 afterC,
        uint256 afterY,
        uint256 afterN,
        uint16 p
    ) external pure {
        BinaryMarketMath.verifyProduct(beforeC, beforeY, beforeN, afterC, afterY, afterN, p);
    }

    function marginal(uint256 c, uint256 y, uint256 n, uint16 p) external pure returns (uint16) {
        return BinaryMarketMath.marginalYesBps(c, y, n, p);
    }
}

/// @notice Actual compiled Solidity results for the independent TypeScript solver,
/// plus the engine constants the frontend must not hard-code silently.
/// @dev Deterministic local simulation only: no broadcast, RPC, or signing key.
/// Output: `{"constants": {...}, "vectors": [...]}`. `MIN_AUTO_TOP_UP` is a
/// decimal string because it has no on-chain getter.
/// Run forge script script/GenerateIndependentVectors.s.sol --tc GenerateIndependentVectors.
contract GenerateIndependentVectors is Script {
    struct State {
        uint256 collateral;
        uint256 yes;
        uint256 no;
    }

    string private constant PATH = "frontend/src/test/fixtures/independent-contract-vectors.json";
    uint256 private constant MAX = 1 << 120;
    uint256 private constant EXPECTED_COUNT = 130;
    IndependentVectorHarness private harness;
    uint256 private count;

    function run() external {
        harness = new IndependentVectorHarness();
        count = 0;
        vm.writeFile(
            PATH,
            string.concat(
                "{\n\"constants\":{\"MIN_AUTO_TOP_UP\":\"", vm.toString(MIN_AUTO_TOP_UP), "\"},\n\"vectors\":[\n"
            )
        );
        _weightedCases();
        _dustCases();
        _invalidCases();
        _boundaryCases();
        _randomCases();
        require(count == EXPECTED_COUNT, "incomplete independent vectors");
        vm.writeLine(PATH, "]\n}");
    }

    function _weightedCases() private {
        uint16[5] memory weights = [uint16(1), 4000, 5000, 6000, 9999];
        for (uint256 i; i < weights.length; ++i) {
            uint16 p = weights[i];
            string memory prefix = string.concat("prior-", vm.toString(uint256(p)), "-");
            State memory initial = State(1000e18, 0, 0);
            _record(string.concat(prefix, "unchanged"), initial, initial, p);
            _record(string.concat(prefix, "buy-yes"), initial, State(1100e18, 150e18, 0), p);
            _record(string.concat(prefix, "buy-no"), initial, State(1100e18, 0, 150e18), p);
            _record(string.concat(prefix, "sell-yes"), State(1100e18, 150e18, 0), State(1050e18, 0, 0), p);
            _record(string.concat(prefix, "sell-no"), State(1100e18, 0, 150e18), State(1050e18, 0, 0), p);
            _record(string.concat(prefix, "neutral-split"), initial, State(1025e18, 25e18, 25e18), p);
            _record(string.concat(prefix, "maximum-yes"), State(MAX, MAX - 1, 0), State(MAX, MAX - 2, 0), p);
            _record(string.concat(prefix, "maximum-no"), State(MAX, 0, MAX - 1), State(MAX, 0, MAX - 2), p);
        }
    }

    function _dustCases() private {
        uint16[3] memory weights = [uint16(1), 5000, 9999];
        uint256[3] memory amounts = [uint256(1), 37, 38];
        for (uint256 i; i < weights.length; ++i) {
            for (uint256 j; j < amounts.length; ++j) {
                uint256 amount = amounts[j];
                string memory name = string.concat("dust-", vm.toString(uint256(weights[i])), "-", vm.toString(amount));
                _record(
                    string.concat(name, "-yes"), State(1000e18, 0, 0), State(1000e18 + amount, amount, 0), weights[i]
                );
                _record(
                    string.concat(name, "-no"), State(1000e18, 0, 0), State(1000e18 + amount, 0, amount), weights[i]
                );
            }
        }
    }

    function _invalidCases() private {
        _record("invalid-zero-collateral", State(0, 0, 0), State(1, 0, 0), 5000);
        _record("invalid-zero-yes-reserve", State(1, 1, 0), State(2, 1, 0), 5000);
        _record("invalid-zero-no-reserve", State(1, 0, 1), State(2, 0, 1), 5000);
        _record("invalid-collateral-overflow", State(MAX, 0, 0), State(MAX + 1, 0, 0), 5000);
        _record("invalid-zero-weight", State(1000, 0, 0), State(1000, 0, 0), 0);
        _record("invalid-one-weight", State(1000, 0, 0), State(1000, 0, 0), 10_000);
    }

    function _boundaryCases() private {
        uint256 exact = 1100e18 - (uint256(1000e18) ** 2 + 1100e18 - 1) / 1100e18;
        _record("analytic-5050-boundary", State(1000e18, 0, 0), State(1100e18, exact, 0), 5000);
        _record("analytic-5050-conservative", State(1000e18, 0, 0), State(1100e18, exact - 1_000_000, 0), 5000);
    }

    function _randomCases() private {
        for (uint256 i; i < 64; ++i) {
            uint256 entropy = uint256(keccak256(abi.encode("CHAOS_ZERO_INDEPENDENT_VECTORS_V1", i)));
            uint256 c = 2 + entropy % ((uint256(1) << (2 + (i * 17) % 118)) - 1);
            State memory before_ = State(c, 1 + (entropy >> 31) % (c - 1), 1 + (entropy >> 91) % (c - 1));
            // Every draw lies in 1..9999, so narrowing to uint16 is exact.
            // forge-lint: disable-next-line(unsafe-typecast)
            uint16 p = uint16(1 + (entropy >> 171) % 9999);
            bool yes = (i & 1) == 0;
            bool buy = (i & 2) == 0;
            uint256 cash = 1 + (entropy >> 113) % (c / 8 + 1);
            uint256 units =
                buy ? 1 + (entropy >> 143) % (c / 3 + 1) : 1 + (entropy >> 143) % (yes ? before_.yes : before_.no);
            State memory after_ = State(buy ? c + cash : c - cash, before_.yes, before_.no);
            if (yes) after_.yes = buy ? after_.yes + units : after_.yes - units;
            else after_.no = buy ? after_.no + units : after_.no - units;
            _record(
                string.concat("random-", vm.toString(i), buy ? "-buy-" : "-sell-", yes ? "yes" : "no"),
                before_,
                after_,
                p
            );
        }
    }

    function _record(string memory name, State memory before_, State memory after_, uint16 p) private {
        bool accepted;
        try harness.verify(before_.collateral, before_.yes, before_.no, after_.collateral, after_.yes, after_.no, p) {
            accepted = true;
        } catch {
            accepted = false;
        }
        string memory entry = string.concat(
            "{\"name\":\"",
            name,
            "\",\"initialYesBps\":",
            vm.toString(uint256(p)),
            ",\"before\":",
            _state(before_),
            ",\"after\":",
            _state(after_),
            ",\"accepted\":",
            accepted ? "true" : "false",
            ",\"beforeMarginalBps\":",
            _marginal(before_, p),
            ",\"afterMarginalBps\":",
            _marginal(after_, p),
            "}"
        );
        console.log(string.concat("INDEPENDENT_VECTOR ", entry));
        vm.writeLine(PATH, string.concat(entry, count + 1 == EXPECTED_COUNT ? "" : ","));
        ++count;
    }

    function _state(State memory value) private pure returns (string memory) {
        return string.concat(
            "{\"collateral\":\"",
            vm.toString(value.collateral),
            "\",\"yes\":\"",
            vm.toString(value.yes),
            "\",\"no\":\"",
            vm.toString(value.no),
            "\"}"
        );
    }

    function _marginal(State memory value, uint16 p) private view returns (string memory) {
        try harness.marginal(value.collateral, value.yes, value.no, p) returns (uint16 probability) {
            return vm.toString(uint256(probability));
        } catch {
            return "null";
        }
    }
}
