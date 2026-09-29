// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {Test} from "forge-std/Test.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {GestureSeriesMarket} from "../src/GestureSeriesMarket.sol";
import {ICosmicSignatureGame} from "../src/ICosmicSignatureGame.sol";
import {ArbitrumForkTest, ArbitrumOne} from "./utils/ArbitrumOne.sol";

/// @dev What went into the deployment transaction, parsed from forge's
/// broadcast record.
struct DeploymentRecord {
    address contractAddress;
    address deployer;
    uint256 nonce;
    address constructorArg;
    bytes initcode;
    uint256 blockNumber;
}

/// @dev Shared reader for the broadcast record.
abstract contract BroadcastReader is Test {
    string internal constant BROADCAST = "broadcast/Deploy.s.sol/42161/run-latest.json";

    function _readBroadcast() internal view returns (DeploymentRecord memory d, string memory json) {
        // Read-only, and fs_permissions in foundry.toml scope it to this one file.
        // forge-lint: disable-next-line(unsafe-cheatcode)
        json = vm.readFile(BROADCAST);
        d.contractAddress = vm.parseJsonAddress(json, ".transactions[0].contractAddress");
        d.deployer = vm.parseJsonAddress(json, ".transactions[0].transaction.from");
        d.nonce = vm.parseJsonUint(json, ".transactions[0].transaction.nonce");
        d.constructorArg = vm.parseJsonAddress(json, ".transactions[0].arguments[0]");
        d.initcode = vm.parseJsonBytes(json, ".transactions[0].transaction.input");
        d.blockNumber = vm.parseJsonUint(json, ".receipts[0].blockNumber");
    }
}

/// @notice The chain of custody from this repository to the contract users
/// actually touch, checked offline on every `forge test`:
///
///   src/ + foundry.toml  --compile-->  initcode
///   initcode ++ abi.encode(game)  ==  the recorded deployment transaction
///   recorded deployment  ==  the address the production frontend targets
///
/// The market is immutable (no owner, no proxy), so the source in this repo
/// is only trustworthy while it compiles to exactly what was deployed —
/// including the CBOR metadata hash that block explorers verify against.
contract DeploymentIntegrityTest is BroadcastReader {
    string internal constant ENV_PRODUCTION = "frontend/.env.production";
    string internal constant ARTIFACT = "GestureSeriesMarket.sol:GestureSeriesMarket";

    /// The broadcast record describes exactly one successful CREATE of the
    /// market, by nonce 0 of the deployer, landing at the canonical address.
    function test_broadcastRecordsTheCanonicalDeployment() public view {
        (DeploymentRecord memory d, string memory json) = _readBroadcast();

        assertEq(vm.parseJsonUint(json, ".chain"), ArbitrumOne.CHAIN_ID, "broadcast is not for Arbitrum One");
        assertFalse(vm.keyExistsJson(json, ".transactions[1]"), "the deployment must be a single transaction");
        assertEq(vm.parseJsonString(json, ".transactions[0].transactionType"), "CREATE");
        assertEq(vm.parseJsonString(json, ".transactions[0].contractName"), "GestureSeriesMarket");
        assertEq(vm.parseJsonUint(json, ".transactions[0].transaction.chainId"), ArbitrumOne.CHAIN_ID);
        assertEq(vm.parseJsonUint(json, ".transactions[0].transaction.value"), 0, "the constructor is not payable");

        assertEq(d.contractAddress, ArbitrumOne.MARKET, "recorded market address");
        assertEq(
            vm.computeCreateAddress(d.deployer, d.nonce),
            d.contractAddress,
            "CREATE address must derive from sender+nonce"
        );
        assertEq(d.constructorArg, ArbitrumOne.GAME, "the market must be bound to the Cosmic Signature game proxy");

        assertEq(vm.parseJsonUint(json, ".receipts[0].status"), 1, "the deployment transaction reverted");
        assertEq(vm.parseJsonAddress(json, ".receipts[0].contractAddress"), ArbitrumOne.MARKET, "receipt address");
        assertEq(d.blockNumber, ArbitrumOne.MARKET_DEPLOY_BLOCK, "receipt block");
    }

    /// THE reproducibility check: today's source and compiler settings must
    /// rebuild the deployment transaction's input byte for byte.
    function test_sourceReproducesTheDeployedInitcode() public {
        // Coverage instruments an unoptimized, non-IR build; it can never match.
        vm.skip(vm.isContext(VmSafe.ForgeContext.Coverage), "coverage builds are not production bytecode");

        (DeploymentRecord memory d,) = _readBroadcast();
        bytes memory creationCode = vm.getCode(ARTIFACT);
        assertEq(
            keccak256(type(GestureSeriesMarket).creationCode),
            keccak256(creationCode),
            "the test build and the standalone artifact disagree on GestureSeriesMarket's creation code"
        );

        bytes memory rebuilt = abi.encodePacked(creationCode, abi.encode(ICosmicSignatureGame(d.constructorArg)));
        if (keccak256(rebuilt) != keccak256(d.initcode)) {
            fail(_driftReport(d.initcode, rebuilt, creationCode.length));
        }
    }

    /// The production frontend talks to the recorded deployment on the
    /// recorded chain, and scans events from the block it landed in.
    function test_productionFrontendTargetsTheDeployedMarket() public view {
        (DeploymentRecord memory d,) = _readBroadcast();

        assertEq(
            vm.parseAddress(_dotenv(ENV_PRODUCTION, "NEXT_PUBLIC_MARKET_ADDRESS")),
            d.contractAddress,
            "frontend/.env.production NEXT_PUBLIC_MARKET_ADDRESS is not the deployed market"
        );
        assertEq(
            vm.parseUint(_dotenv(ENV_PRODUCTION, "NEXT_PUBLIC_CHAIN_ID")),
            ArbitrumOne.CHAIN_ID,
            "frontend/.env.production NEXT_PUBLIC_CHAIN_ID is not Arbitrum One"
        );
        assertEq(
            vm.parseUint(_dotenv(ENV_PRODUCTION, "NEXT_PUBLIC_DEPLOY_BLOCK")),
            d.blockNumber,
            "frontend/.env.production NEXT_PUBLIC_DEPLOY_BLOCK is not the deployment block (event scans would miss or waste blocks)"
        );
    }

    /// The drift report is the one thing a developer reads when the check
    /// above fails, so its diagnosis is tested too: every kind of drift
    /// (metadata-only, executable code, constructor argument, length) must be
    /// named correctly.
    function test_driftReportNamesEveryKindOfDrift() public view {
        (DeploymentRecord memory d,) = _readBroadcast();
        uint256 codeLength = d.initcode.length - 32; // minus abi.encode(game)
        string memory report;

        bytes memory drifted = bytes.concat(d.initcode);
        drifted[codeLength - 20] = drifted[codeLength - 20] ^ bytes1(0x01); // inside the IPFS hash
        report = _driftReport(d.initcode, drifted, codeLength);
        assertTrue(vm.contains(report, "only the CBOR metadata hash differs"), report);
        assertTrue(vm.contains(report, "DEPLOYMENT DRIFT"), report);

        drifted = bytes.concat(d.initcode);
        drifted[100] = drifted[100] ^ bytes1(0x01);
        report = _driftReport(d.initcode, drifted, codeLength);
        assertTrue(vm.contains(report, "the executable bytecode differs from byte 100"), report);

        drifted = bytes.concat(d.initcode);
        drifted[drifted.length - 1] = drifted[drifted.length - 1] ^ bytes1(0x01);
        report = _driftReport(d.initcode, drifted, codeLength);
        assertTrue(vm.contains(report, "only the constructor argument differs"), report);

        drifted = bytes.concat(d.initcode, hex"00");
        report = _driftReport(d.initcode, drifted, codeLength + 1);
        assertTrue(vm.contains(report, "the compiled code itself changed"), report);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    /// @dev Explains a reproducibility failure: where the bytes diverge and
    /// what that means, so nobody has to diff 10 KB of hex by hand.
    function _driftReport(bytes memory deployed, bytes memory rebuilt, uint256 creationCodeLength)
        internal
        pure
        returns (string memory)
    {
        string memory what;
        if (deployed.length != rebuilt.length) {
            what = string.concat(
                "the initcode is ",
                vm.toString(rebuilt.length),
                " bytes but the deployment used ",
                vm.toString(deployed.length),
                " (the compiled code itself changed)"
            );
        } else {
            (uint256 first, uint256 last) = _diffRange(deployed, rebuilt);
            // solc appends CBOR metadata (IPFS hash of the sources + solc
            // version) to the runtime code; its length is the final 2 bytes.
            uint256 metadataEnd = creationCodeLength;
            uint256 metadataStart = metadataEnd - 2
                - (uint256(uint8(rebuilt[metadataEnd - 2])) << 8 | uint256(uint8(rebuilt[metadataEnd - 1])));
            if (first >= metadataEnd) {
                what = "only the constructor argument differs (the game address)";
            } else if (first >= metadataStart && last < metadataEnd) {
                what = string.concat(
                    "only the CBOR metadata hash differs (bytes ",
                    vm.toString(first),
                    "-",
                    vm.toString(last),
                    "): the executable code is identical, but the source text changed (even a comment or"
                    " whitespace edit in src/ counts) or a metadata setting did, which breaks block-explorer verification"
                );
            } else {
                what = string.concat("the executable bytecode differs from byte ", vm.toString(first));
            }
        }
        return string.concat(
            "DEPLOYMENT DRIFT: src/ + foundry.toml no longer compile to the GestureSeriesMarket deployed on Arbitrum One at ",
            vm.toString(ArbitrumOne.MARKET),
            " (tx input recorded in ",
            BROADCAST,
            "): ",
            what,
            ". Something under src/ or a [profile.default] compiler setting (solc, optimizer, optimizer_runs, via_ir,"
            " evm_version, metadata/bytecode_hash, the pinned remappings list, which solc records in the metadata even"
            " for libraries src/ never imports) changed. Run `forge clean` first if foundry.toml changed: forge's"
            " cache does not rebuild on a remapping change. The deployed contract is immutable: revert the"
            " change, or ship it as a NEW deployment (new broadcast record, frontend/.env.production, README) so the"
            " repository never describes code other than what users run."
        );
    }

    function _diffRange(bytes memory a, bytes memory b) internal pure returns (uint256 first, uint256 last) {
        first = type(uint256).max;
        for (uint256 i = 0; i < a.length; i++) {
            if (a[i] != b[i]) {
                if (first == type(uint256).max) first = i;
                last = i;
            }
        }
    }

    /// @dev Reads KEY from a dotenv file: exactly one `KEY=value` line
    /// (surrounding whitespace and quotes stripped).
    function _dotenv(string memory path, string memory key) internal view returns (string memory value) {
        // Read-only, and fs_permissions in foundry.toml scope it to this one file.
        // forge-lint: disable-next-line(unsafe-cheatcode)
        string[] memory lines = vm.split(vm.readFile(path), "\n");
        bytes memory prefix = bytes(string.concat(key, "="));
        bool found;
        for (uint256 i = 0; i < lines.length; i++) {
            bytes memory line = bytes(vm.trim(lines[i]));
            if (line.length < prefix.length || keccak256(_slice(line, 0, prefix.length)) != keccak256(prefix)) {
                continue;
            }
            assertFalse(found, string.concat(key, " is defined more than once in ", path));
            found = true;
            bytes memory raw = bytes(vm.trim(string(_slice(line, prefix.length, line.length))));
            if (raw.length >= 2 && (raw[0] == '"' || raw[0] == "'") && raw[raw.length - 1] == raw[0]) {
                raw = _slice(raw, 1, raw.length - 1);
            }
            value = string(raw);
        }
        assertTrue(found, string.concat(key, " is missing from ", path));
    }

    function _slice(bytes memory b, uint256 from, uint256 to) internal pure returns (bytes memory out) {
        out = new bytes(to - from);
        for (uint256 i = from; i < to; i++) {
            out[i - from] = b[i];
        }
    }
}

/// @notice The same chain of custody, checked against the LIVE chain: the
/// runtime code at the production address is exactly what this source
/// deploys, and it is wired to the real game and token. Reported as SKIPPED
/// unless ARBITRUM_RPC_URL is set (see ArbitrumForkTest).
contract DeploymentIntegrityForkTest is ArbitrumForkTest {
    function test_fork_deployedRuntimeCodeMatchesSource() external {
        _forkArbitrumOneOrSkip();
        bytes memory onchain = ArbitrumOne.MARKET.code;
        assertGt(onchain.length, 0, "no contract at the production market address");

        // Same constructor argument => same immutables (`game`, and `cst` as
        // read from the live game), so the runtime code must be identical,
        // CBOR metadata included.
        GestureSeriesMarket rebuilt = new GestureSeriesMarket(ICosmicSignatureGame(ArbitrumOne.GAME));
        assertEq(
            keccak256(address(rebuilt).code),
            keccak256(onchain),
            "DEPLOYMENT DRIFT: the runtime code live at the production market address differs from what src/ deploys"
            " today with the same constructor argument (if test_fork_deployedMarketWiring also fails, the game's"
            " token() changed instead)"
        );
        assertEq(ArbitrumOne.MARKET.codehash, address(rebuilt).codehash, "codehash");
    }

    function test_fork_deployedMarketWiring() external {
        _forkArbitrumOneOrSkip();
        GestureSeriesMarket market = GestureSeriesMarket(ArbitrumOne.MARKET);
        assertEq(address(market.game()), ArbitrumOne.GAME, "market.game()");
        assertEq(address(market.cst()), ArbitrumOne.CST, "market.cst()");
        assertEq(ICosmicSignatureGame(ArbitrumOne.GAME).token(), ArbitrumOne.CST, "the game now reports another token");
        assertGt(ICosmicSignatureGame(ArbitrumOne.GAME).roundNum(), 0, "live game round counter");
    }
}
