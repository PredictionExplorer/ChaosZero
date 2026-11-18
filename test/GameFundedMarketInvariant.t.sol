// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {GameFundedOutcomeMarket} from "../src/GameFundedOutcomeMarket.sol";
import {IndependentOutcomeMarket, IIndependentCollateral} from "../src/IndependentOutcomeMarket.sol";
import {LocalCosmicGame} from "../src/local/LocalCosmicGame.sol";
import {LocalCst} from "../src/local/LocalCst.sol";
import {LocalOutcomeSource} from "../src/local/LocalOutcomeSource.sol";

contract GameFundingHandler is Test, ERC1155Holder {
    LocalCosmicGame private immutable game;
    LocalCst private immutable token;
    GameFundedOutcomeMarket private immutable market;
    uint256 public unsolicited;
    uint256 public vaultTransfers;

    constructor(LocalCosmicGame game_, GameFundedOutcomeMarket market_) {
        game = game_;
        token = game_.token();
        market = market_;
        token.faucet(1_000_000 ether);
        token.approve(address(market), type(uint256).max);
    }

    function advance() external {
        game.bidEth{value: game.nextEthPrice()}();
        vm.warp(game.mainPrizeTime());
        game.closeCycle();
    }

    function sync() external {
        uint256 cycle = game.roundNum();
        IndependentOutcomeMarket.FundingPreview memory preview = market.fundingPreview(cycle, 0);
        uint256 active = market.roundState(cycle).activeCollateral;
        market.syncFunding(cycle);
        assertEq(market.roundState(cycle).activeCollateral, active + preview.totalFunding);
    }

    function sendUnsolicited(uint96 value, bool toVault) external {
        uint256 amount = bound(value, 0, 10 ether);
        if (toVault) {
            token.transfer(address(market.settlementVault()), amount);
            vaultTransfers += amount;
        } else {
            token.transfer(address(market), amount);
            unsolicited += amount;
        }
    }

    function trade(uint8 inputQuestion, bool yes, bool buy, uint96 value) external {
        uint256 id = game.roundNum();
        uint8 question = inputQuestion % 8;
        uint256 amount = bound(value, 0.01 ether, 1 ether);
        if (buy) {
            market.buy(id, question, yes, amount, amount, block.timestamp);
        } else {
            // These sized trades are always inside the price bound, across all 256 steps
            // of the configured extended campaign (each purchase is at most one CST).
            uint256 balance = market.balanceOf(address(this), market.positionId(id, question, yes));
            if (balance < amount) return;
            market.sell(id, question, yes, amount, amount / 10, block.timestamp);
        }
    }

    function completeSet(uint8 inputQuestion, uint96 value, bool split) external {
        uint256 id = game.roundNum();
        uint8 question = inputQuestion % 8;
        uint256 amount = bound(value, 0.01 ether, 10 ether);
        if (split) {
            market.splitPosition(id, question, amount);
        } else {
            if (
                market.balanceOf(address(this), market.positionId(id, question, true)) < amount
                    || market.balanceOf(address(this), market.positionId(id, question, false)) < amount
            ) return;
            market.mergePosition(id, question, amount);
        }
    }

    function settleOrClaim(uint96 seed, bool claim) external {
        uint256 current = game.roundNum();
        if (current == 1) return;
        uint256 id = 1 + uint256(seed) % (current - 1);
        if (!market.roundState(id).initialized) return;
        if (claim) market.claimKnown(id);
        else market.settleRound(id);
    }
}

contract GameFundedMarketInvariantTest is Test {
    LocalCosmicGame private game;
    LocalCst private token;
    GameFundedOutcomeMarket private market;
    GameFundingHandler private handler;

    function setUp() public {
        vm.chainId(31337);
        vm.warp(100_000);
        game = new LocalCosmicGame();
        token = game.token();
        LocalOutcomeSource source = new LocalOutcomeSource(game);
        market = new GameFundedOutcomeMarket(IIndependentCollateral(address(token)), source, address(game));
        game.setChaosZeroMarket(address(market));
        handler = new GameFundingHandler(game, market);
        vm.deal(address(handler), 100 ether);
        bytes4[] memory actions = new bytes4[](6);
        actions[0] = handler.advance.selector;
        actions[1] = handler.sync.selector;
        actions[2] = handler.sendUnsolicited.selector;
        actions[3] = handler.trade.selector;
        actions[4] = handler.completeSet.selector;
        actions[5] = handler.settleOrClaim.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: actions}));
    }

    function invariant_onlyTheGamesIssuedGrantsAndAccountedTradingCollateralEnterPools() public view {
        (uint256 amount, uint256 issued) = game.chaosZeroFunding(address(market), game.roundNum());
        assertEq(amount, 8000 ether);
        assertEq(issued, amount * game.roundNum());
        uint256 unapplied = issued - market.consumedGameFunding();
        assertEq(
            token.balanceOf(address(market)),
            market.totalActiveCollateral() + market.pendingCarry() + unapplied + handler.unsolicited()
        );
        assertEq(
            token.balanceOf(address(market.settlementVault())),
            market.settlementVault().totalEscrowed() + handler.vaultTransfers()
        );
        assertEq(token.balanceOf(address(game)), 0);
        uint256 last = market.lastFundedRound();
        assertEq(market.consumedGameFunding(), amount * last);
        assertEq(market.totalActiveCollateral(), market.roundState(last).activeCollateral);
    }
}
