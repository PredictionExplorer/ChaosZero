// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {Test} from "forge-std/Test.sol";

/// @notice The production deployment on Arbitrum One, stated once for every
/// suite. None of these constants is taken on faith: the market address and
/// deploy block are cross-checked offline against the broadcast record and
/// the frontend's production config (DeploymentIntegrity.t.sol), and the
/// whole wiring is checked against the live chain by the fork suites.
library ArbitrumOne {
    uint256 internal constant CHAIN_ID = 42_161;
    /// @dev CosmicSignatureGame proxy: the market's only constructor argument.
    address internal constant GAME = 0x6a714Ae7B5b6eA520F6BCA23d2E609C4Fd5863F2;
    /// @dev CosmicSignatureToken, read by the market from `GAME.token()`.
    address internal constant CST = 0xAD91843e6A58Ba560F577E676986AFb1dba6FBA0;
    /// @dev The GestureSeriesMarket singleton users interact with.
    address internal constant MARKET = 0xDe5bC71e94B991265B2DfDCE0921245B70c51b4d;
    uint256 internal constant MARKET_DEPLOY_BLOCK = 480_403_593;
}

/// @notice Base for suites that run against a fork of Arbitrum One. Every
/// such contract has "Fork" in its name, so CI selects them with
/// `forge test --match-contract Fork`.
///
///   ARBITRUM_RPC_URL     RPC endpoint; when unset the tests report SKIPPED
///   ARBITRUM_FORK_BLOCK  optional block to pin (reproducible, RPC-cacheable)
///   REQUIRE_FORK_TESTS   set to `true` in jobs that must never skip them
abstract contract ArbitrumForkTest is Test {
    function _forkArbitrumOneOrSkip() internal {
        string memory rpcUrl = vm.envOr("ARBITRUM_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) {
            if (vm.envOr("REQUIRE_FORK_TESTS", false)) {
                revert("REQUIRE_FORK_TESTS=true but ARBITRUM_RPC_URL is not set");
            }
            vm.skip(true, "ARBITRUM_RPC_URL not set");
        }
        uint256 forkBlock = vm.envOr("ARBITRUM_FORK_BLOCK", uint256(0));
        if (forkBlock == 0) vm.createSelectFork(rpcUrl);
        else vm.createSelectFork(rpcUrl, forkBlock);
        assertEq(block.chainid, ArbitrumOne.CHAIN_ID, "ARBITRUM_RPC_URL must point at Arbitrum One");
    }
}
