// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Script} from "forge-std/Script.sol";
import {Vm} from "forge-std/Vm.sol";
import {SharedOutcomeMarketVectorsTest} from "../test/SharedOutcomeMarketVectors.t.sol";
import {Log2Bounds} from "../src/libraries/Log2Bounds.sol";

/// @notice Deterministically export actual contract results for TypeScript parity.
/// @dev This script simulates only; it never starts a broadcast or reads a key.
/// Ordinary Forge tests emit vectors but do not write or mutate fixture files.
contract GenerateSharedVectors is Script {
    function run() external {
        SharedOutcomeMarketVectorsTest generator = new SharedOutcomeMarketVectorsTest();
        generator.setUp();
        vm.recordLogs();
        generator.test_emitLogVectors();
        generator.test_emitTradeVectors();
        Vm.Log[] memory logs = vm.getRecordedLogs();
        // 26 existing vectors, 361 power/neighbor inputs, 256 pseudorandom inputs.
        string[] memory entries = new string[](643);
        uint256 count;
        for (uint256 i; i < logs.length; ++i) {
            if (
                logs[i].emitter != address(generator) || logs[i].topics.length != 1
                    || logs[i].topics[0] != keccak256("log(string)")
            ) continue;
            bytes memory line = bytes(abi.decode(logs[i].data, (string)));
            bytes memory prefix = bytes("SHARED_VECTOR ");
            if (line.length <= prefix.length) continue;
            bool matches = true;
            for (uint256 j; j < prefix.length; ++j) {
                if (line[j] != prefix[j]) matches = false;
            }
            if (!matches) continue;
            bytes memory entry = new bytes(line.length - prefix.length);
            for (uint256 j; j < entry.length; ++j) {
                entry[j] = line[j + prefix.length];
            }
            entries[count++] = string(entry);
        }
        require(count == 26, "incomplete shared differential vectors");
        uint256 maximum = uint256(1) << 120;
        for (uint256 exponent; exponent <= 120; ++exponent) {
            uint256 power = uint256(1) << exponent;
            if (power > 1) entries[count++] = _logVector(power - 1);
            entries[count++] = _logVector(power);
            if (power < maximum) entries[count++] = _logVector(power + 1);
        }
        for (uint256 i; i < 256; ++i) {
            uint256 bits = 1 + i % 120;
            uint256 entropy = uint256(keccak256(abi.encode("CHAOS_ZERO_LOG_ORACLE_V1", i)));
            entries[count++] = _logVector(1 + entropy % (uint256(1) << bits));
        }
        require(count == entries.length, "incomplete independent oracle vectors");
        string memory path = "frontend/src/test/fixtures/shared-contract-vectors.json";
        vm.writeFile(path, "[\n");
        // Host-side line writes avoid quadratic EVM memory from a growing concat.
        for (uint256 i; i < count; ++i) {
            vm.writeLine(path, string.concat(entries[i], i + 1 == count ? "" : ","));
        }
        vm.writeLine(path, "]");
    }

    function _logVector(uint256 input) private pure returns (string memory) {
        (uint256 lower, uint256 upper) = Log2Bounds.bounds(input);
        return string.concat(
            "{\"kind\":\"log\",\"input\":\"",
            vm.toString(input),
            "\",\"lower\":\"",
            vm.toString(lower),
            "\",\"upper\":\"",
            vm.toString(upper),
            "\"}"
        );
    }
}
