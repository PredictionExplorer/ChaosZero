// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Script, console} from "forge-std/Script.sol";
import {SharedOutcomeMarket, ISharedCollateral} from "../src/SharedOutcomeMarket.sol";
import {LocalCosmicGame} from "../src/local/LocalCosmicGame.sol";
import {LocalOutcomeSource} from "../src/local/LocalOutcomeSource.sol";
import {LocalCst} from "../src/local/LocalCst.sol";

/// @notice Complete disposable shared-market setup. Never broadcasts on a public chain.
contract DeploySharedLocal is Script {
    error LocalChainOnly();

    function run() external returns (LocalCosmicGame game, LocalOutcomeSource source, SharedOutcomeMarket market) {
        if (block.chainid != 31337) revert LocalChainOnly();
        vm.startBroadcast();
        game = new LocalCosmicGame();
        LocalCst cst = game.token();
        source = new LocalOutcomeSource(game);
        market = new SharedOutcomeMarket(ISharedCollateral(address(cst)), source);
        cst.faucet(100_000 ether);
        cst.approve(address(market), 10_000 ether);
        market.fundRound(game.roundNum(), 10_000 ether);
        vm.stopBroadcast();
        console.log("Local game:", address(game));
        console.log("Fake CST:", address(cst));
        console.log("Local outcome source:", address(source));
        console.log("Shared eight-question market:", address(market));
    }
}
