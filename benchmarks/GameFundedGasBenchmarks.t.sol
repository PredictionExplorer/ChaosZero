// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {GameFundedOutcomeMarket} from "../src/GameFundedOutcomeMarket.sol";
import {IIndependentCollateral} from "../src/IndependentOutcomeMarket.sol";
import {OutcomeSettlementVault} from "../src/OutcomeSettlementVault.sol";
import {LocalCosmicGame} from "../src/local/LocalCosmicGame.sol";
import {LocalCst} from "../src/local/LocalCst.sol";
import {LocalOutcomeSource} from "../src/local/LocalOutcomeSource.sol";

/// @dev Run via scripts/check-v4-gas.sh. Each measured external call starts in its own transaction.
contract GameFundedGasBenchmarksTest is Test {
    uint256 private constant GRANT = 8_000 ether;
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);
    LocalCosmicGame private game;
    LocalCst private token;
    GameFundedOutcomeMarket private market;
    OutcomeSettlementVault private vault;

    function setUp() public {
        vm.chainId(31337);
        vm.warp(100_000);
        vm.deal(address(this), 10 ether);
        game = new LocalCosmicGame();
        token = game.token();
        market = new GameFundedOutcomeMarket(
            IIndependentCollateral(address(token)), new LocalOutcomeSource(game), address(game)
        );
        vault = market.settlementVault();
        _fundTrader(ALICE);
        _fundTrader(BOB);
        game.setChaosZeroMarket(address(market));
    }

    function _fundTrader(address user) private {
        vm.startPrank(user);
        token.faucet(1_000 ether);
        token.approve(address(market), type(uint256).max);
        vm.stopPrank();
    }

    function _advanceCycle() private {
        game.bidEth{value: game.nextEthPrice()}();
        vm.warp(game.mainPrizeTime());
        game.closeCycle();
    }

    function _assertOpening(uint256 cycle, uint256 expected) private view {
        assertEq(market.consumedGameFunding(), expected);
        assertEq(market.totalActiveCollateral(), expected);
        assertEq(token.balanceOf(address(market)), expected);
        for (uint8 q; q < 8; ++q) {
            assertEq(market.questionState(cycle, q).activeCollateral, expected / 8);
        }
    }

    function test_initialSyncAndRepeat() public {
        market.syncFunding(1);
        vm.snapshotGasLastCall("sync_first_cycle");
        _assertOpening(1, GRANT);

        market.syncFunding(1);
        vm.snapshotGasLastCall("sync_already_funded");
        _assertOpening(1, GRANT);
    }

    function test_syncAfterOneUnusedCycle() public {
        _advanceCycle();
        market.syncFunding(2);
        vm.snapshotGasLastCall("sync_after_1_unused_cycle");
        _assertOpening(2, 2 * GRANT);
    }

    function test_syncAfterThirtyTwoUnusedCycles() public {
        for (uint256 i; i < 32; ++i) {
            _advanceCycle();
        }
        market.syncFunding(33);
        vm.snapshotGasLastCall("sync_after_32_unused_cycles");
        _assertOpening(33, 33 * GRANT);
        market.syncFunding(33);
        _assertOpening(33, 33 * GRANT);
    }

    function test_buyAndSellFundedQuestion() public {
        market.syncFunding(1);

        vm.startPrank(ALICE);
        market.buy(1, 0, true, 100 ether, 150 ether, block.timestamp);
        vm.snapshotGasLastCall("buy_funded_question");
        assertEq(market.balanceOf(ALICE, market.positionId(1, 0, true)), 150 ether);

        market.sell(1, 0, true, 50 ether, 1 ether, block.timestamp);
        vm.snapshotGasLastCall("sell_funded_question");
        vm.stopPrank();
        assertEq(market.balanceOf(ALICE, market.positionId(1, 0, true)), 100 ether);
        assertEq(market.questionState(1, 0).activeCollateral, GRANT / 8 + 99 ether);
        assertEq(token.balanceOf(ALICE), 901 ether);
        assertEq(market.consumedGameFunding(), GRANT);
    }

    function test_splitAndMergePairs() public {
        market.syncFunding(1);
        vm.startPrank(ALICE);
        market.splitPosition(1, 0, 8 ether);
        vm.snapshotGasLastCall("split_funded_question");
        assertEq(market.balanceOf(ALICE, market.positionId(1, 0, true)), 8 ether);
        assertEq(market.balanceOf(ALICE, market.positionId(1, 0, false)), 8 ether);

        uint256 merged = market.mergePosition(1, 0, 7 ether);
        vm.snapshotGasLastCall("merge_one_funded_question");
        assertEq(merged, 7 ether);

        uint256[8] memory amounts;
        amounts[0] = 1 ether;
        for (uint8 q = 1; q < 8; ++q) {
            market.splitPosition(1, q, 1 ether);
            amounts[q] = 1 ether;
        }
        merged = market.mergePositions(1, amounts);
        vm.snapshotGasLastCall("merge_all_8_funded_questions");
        vm.stopPrank();
        assertEq(merged, 8 ether);
        assertEq(token.balanceOf(ALICE), 1_000 ether);
        _assertOpening(1, GRANT);
    }

    function test_explicitSettlementAndAllQuestionClaim() public {
        uint256 total;
        vm.startPrank(ALICE);
        for (uint8 q; q < 8; ++q) {
            uint256 pairs = (uint256(q) + 1) * 1 ether;
            market.splitPosition(1, q, pairs);
            total += pairs;
        }
        vm.stopPrank();
        _advanceCycle();
        (uint256 escrowed, uint256 carried) = market.settleRound(1);
        vm.snapshotGasLastCall("settle_outstanding_units_on_all_8_questions");
        assertEq(escrowed, total);
        assertEq(carried, GRANT);
        assertEq(market.totalActiveCollateral(), 0);
        for (uint8 q; q < 8; ++q) {
            assertEq(vault.remaining(1, q), (uint256(q) + 1) * 1 ether);
        }

        market.syncFunding(2);
        _assertOpening(2, 2 * GRANT);
        assertEq(vault.totalEscrowed(), total);
        assertEq(token.balanceOf(address(vault)), total);
        vm.prank(ALICE);
        uint256 paid = market.claimKnown(1);
        vm.snapshotGasLastCall("claim_all_8_from_earlier_cycle");
        assertEq(paid, total);
        assertEq(token.balanceOf(ALICE), 1_000 ether);
        assertEq(vault.totalEscrowed(), 0);
        assertEq(token.balanceOf(address(vault)), 0);
        _assertOpening(2, 2 * GRANT);
    }

    function test_firstBuySettlesPreviousUsedCycleAndSkipsQuietCycles() public {
        // Closing with one gesture makes question 5 YES. Alice owns 150 winning
        // units; Bob's seven pairs reserve another seven CST, regardless of side.
        vm.prank(ALICE);
        market.buy(1, 5, true, 100 ether, 150 ether, block.timestamp);
        vm.prank(BOB);
        market.splitPosition(1, 5, 7 ether);
        _advanceCycle();
        _advanceCycle();
        _advanceCycle();

        vm.prank(BOB);
        market.buy(4, 0, false, 1 ether, 1 ether, block.timestamp);
        vm.snapshotGasLastCall("first_buy_with_prior_claims_and_2_quiet_cycles");
        assertTrue(market.roundState(1).settled);
        assertEq(market.consumedGameFunding(), 4 * GRANT);
        uint256 active = 4 * GRANT - 50 ether + 1 ether;
        assertEq(market.totalActiveCollateral(), active);
        assertEq(token.balanceOf(address(market)), active);
        assertEq(vault.remaining(1, 5), 157 ether);
        assertEq(vault.totalEscrowed(), 157 ether);
        assertEq(token.balanceOf(address(vault)), 157 ether);

        market.syncFunding(4);
        vm.prank(BOB);
        uint256 merged = market.mergePosition(1, 5, 7 ether);
        vm.snapshotGasLastCall("merge_earlier_cycle_pairs_from_vault");
        assertEq(merged, 7 ether);
        assertEq(vault.remaining(1, 5), 150 ether);
        assertEq(vault.totalEscrowed(), 150 ether);
        assertEq(token.balanceOf(address(vault)), 150 ether);
        vm.prank(ALICE);
        uint256 paid = market.claimKnown(1);
        vm.snapshotGasLastCall("claim_one_from_earlier_cycle");
        assertEq(paid, 150 ether);
        assertEq(token.balanceOf(ALICE), 1_050 ether);
        assertEq(vault.totalEscrowed(), 0);
        assertEq(token.balanceOf(address(vault)), 0);
        assertEq(market.consumedGameFunding(), 4 * GRANT);
        assertEq(market.totalActiveCollateral(), active);
    }
}
