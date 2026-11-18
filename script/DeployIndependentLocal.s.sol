// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Script, console} from "forge-std/Script.sol";
import {IndependentOutcomeMarket, IIndependentCollateral} from "../src/IndependentOutcomeMarket.sol";
import {GameFundedOutcomeMarket} from "../src/GameFundedOutcomeMarket.sol";
import {LocalCosmicGame} from "../src/local/LocalCosmicGame.sol";
import {LocalOutcomeSource} from "../src/local/LocalOutcomeSource.sol";
import {LocalCst} from "../src/local/LocalCst.sol";

/// @notice Successor and previous-market fixture on the same disposable game and token.
contract DeployIndependentLocal is Script {
    error LocalChainOnly();

    function run() external returns (LocalCosmicGame game, LocalOutcomeSource source, GameFundedOutcomeMarket market) {
        if (block.chainid != 31337) revert LocalChainOnly();
        vm.startBroadcast();
        game = new LocalCosmicGame();
        LocalCst cst = game.token();
        source = new LocalOutcomeSource(game);
        IndependentOutcomeMarket previous = new IndependentOutcomeMarket(IIndependentCollateral(address(cst)), source);
        cst.faucet(100_000 ether);
        cst.approve(address(previous), 10_000 ether);
        previous.fundRound(game.roundNum(), 10_000 ether);
        market = new GameFundedOutcomeMarket(IIndependentCollateral(address(cst)), source, address(game));
        game.setChaosZeroMarket(address(market));
        market.syncFunding(game.roundNum());
        vm.stopBroadcast();
        console.log("Local game:", address(game));
        console.log("Fake CST:", address(cst));
        console.log("Local outcome source:", address(source));
        console.log("Previous eight-question market:", address(previous));
        console.log("Game-funded eight-question market:", address(market));
        console.log("Closed-cycle payout vault:", address(market.settlementVault()));
    }
}
