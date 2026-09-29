// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Script} from "forge-std/Script.sol";
import {Log2Bounds} from "../src/libraries/Log2Bounds.sol";

/// @notice Deterministically export actual Log2Bounds results for the independent
/// 170-digit Decimal oracle and the TypeScript port.
/// @dev This script simulates only; it never starts a broadcast or reads a key.
/// Ordinary Forge tests do not write or mutate fixture files.
contract GenerateLogBoundsVectors is Script {
    function run() external {
        // 14 fixed regression inputs, 361 power/neighbor inputs, 256 pseudorandom inputs.
        string[] memory entries = new string[](631);
        uint256 count;
        uint256[14] memory inputs = [
            uint256(1),
            2,
            3,
            10,
            1e12 - 1,
            1e12,
            1e18 - 1,
            1e18,
            1000e18,
            (uint256(1) << 64) - 1,
            uint256(1) << 64,
            (uint256(1) << 120) - 1,
            uint256(1) << 120,
            667601134098543439318150072872112656
        ];
        for (uint256 i; i < inputs.length; ++i) {
            entries[count++] = _logVector(inputs[i]);
        }
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
        require(count == 631, "incomplete logarithm oracle vectors");
        string memory path = "frontend/src/test/fixtures/log2-bounds-vectors.json";
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
