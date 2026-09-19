// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Script, console} from "forge-std/Script.sol";
import {IndependentOutcomeMarket, IIndependentCollateral} from "../src/IndependentOutcomeMarket.sol";
import {LocalCosmicGame} from "../src/local/LocalCosmicGame.sol";
import {LocalOutcomeSource} from "../src/local/LocalOutcomeSource.sol";
import {LocalCst} from "../src/local/LocalCst.sol";

/// @notice Disposable eight-pool system, funded equally by one local contribution.
contract DeployIndependentLocal is Script {
    error LocalChainOnly();

    function run() external returns (LocalCosmicGame game, LocalOutcomeSource source, IndependentOutcomeMarket market) {
        if (block.chainid != 31337) revert LocalChainOnly();
        vm.startBroadcast();
        game = new LocalCosmicGame();
        LocalCst cst = game.token();
        source = new LocalOutcomeSource(game);
        market = new IndependentOutcomeMarket(IIndependentCollateral(address(cst)), source);
        cst.faucet(100_000 ether);
        cst.approve(address(market), 10_000 ether);
        market.fundRound(game.roundNum(), 10_000 ether);
        vm.stopBroadcast();
        console.log("Local game:", address(game));
        console.log("Fake CST:", address(cst));
        console.log("Local outcome source:", address(source));
        console.log("Independent eight-question market:", address(market));
        console.log("Closed-cycle payout vault:", address(market.settlementVault()));
    }
}
