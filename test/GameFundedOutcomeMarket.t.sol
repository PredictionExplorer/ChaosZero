// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {GameFundedMarketViews} from "../src/GameFundedMarketViews.sol";
import {GameFundedOutcomeMarket} from "../src/GameFundedOutcomeMarket.sol";
import {IndependentOutcomeMarket, IIndependentCollateral} from "../src/IndependentOutcomeMarket.sol";
import {LocalCosmicGame} from "../src/local/LocalCosmicGame.sol";
import {LocalCst} from "../src/local/LocalCst.sol";
import {LocalOutcomeSource} from "../src/local/LocalOutcomeSource.sol";

contract GameFundedOutcomeMarketTest is Test, ERC1155Holder {
    uint256 private constant GRANT = 8000 ether;
    LocalCosmicGame private game;
    LocalOutcomeSource private source;
    LocalCst private token;
    GameFundedOutcomeMarket private market;

    function setUp() public {
        vm.chainId(31337);
        vm.warp(100_000);
        vm.deal(address(this), 100 ether);
        game = new LocalCosmicGame();
        source = new LocalOutcomeSource(game);
        token = game.token();
        market = new GameFundedOutcomeMarket(IIndependentCollateral(address(token)), source, address(game));
        token.faucet(1000 ether);
        token.approve(address(market), type(uint256).max);
    }

    function _advance() private {
        game.bidEth{value: game.nextEthPrice()}();
        vm.warp(game.mainPrizeTime());
        game.closeCycle();
    }

    function test_preFundingAndWrongGameCannotSeedThePools() public {
        token.transfer(address(market), GRANT / 8);
        vm.expectRevert(GameFundedOutcomeMarket.NotFunded.selector);
        market.syncFunding(1);
        vm.expectRevert(GameFundedOutcomeMarket.NotFunded.selector);
        market.splitPosition(1, 0, 1 ether);
        vm.expectRevert(GameFundedOutcomeMarket.NotFunded.selector);
        market.buy(1, 0, true, 1 ether, 1 ether, block.timestamp);
        assertFalse(market.fundingPreview(1, 0).canFund);
        (bool publicFunding,) = address(market).call(abi.encodeCall(IndependentOutcomeMarket.fundRound, (1, 2 ether)));
        assertFalse(publicFunding);
        LocalCosmicGame other = new LocalCosmicGame();
        IIndependentCollateral otherToken = IIndependentCollateral(address(other.token()));
        vm.expectRevert(GameFundedOutcomeMarket.InvalidParameters.selector);
        new GameFundedOutcomeMarket(otherToken, source, address(other));
        vm.expectRevert(GameFundedOutcomeMarket.InvalidParameters.selector);
        new GameFundedOutcomeMarket(IIndependentCollateral(address(token)), source, address(other));
        vm.expectRevert(LocalCosmicGame.InvalidMarket.selector);
        vm.prank(address(123));
        game.setChaosZeroMarket(address(market));
        game.setChaosZeroMarket(address(market));
        vm.expectRevert(LocalCosmicGame.InvalidMarket.selector);
        game.setChaosZeroMarket(address(market));
        (uint256 amount, uint256 cumulative) = game.chaosZeroFunding(address(other), 1);
        assertEq(amount | cumulative, 0);
    }

    function testFuzz_transfersNeverAlterQuotesOrGrantAccounting(uint128 beforeSeed, uint128 afterSeed) public {
        uint256 early = bound(beforeSeed, 0, 400 ether);
        uint256 late = bound(afterSeed, 0, 400 ether);
        token.transfer(address(market), early);
        uint256 supply = token.totalSupply();
        game.setChaosZeroMarket(address(market));
        assertEq(token.totalSupply(), supply + GRANT);
        IndependentOutcomeMarket.FundingPreview memory preview = market.fundingPreview(1, 0);
        assertEq(preview.totalFunding, GRANT);
        assertEq(preview.unallocated, 0);
        vm.prank(address(111));
        market.syncFunding(1);
        token.transfer(address(market), late);
        market.syncFunding(1);
        assertFalse(market.fundingPreview(1, 0).canFund);
        assertEq(market.consumedGameFunding(), GRANT);
        for (uint8 q; q < 8; ++q) {
            assertEq(preview.allocations[q], GRANT / 8);
            assertEq(market.questionState(1, q).activeCollateral, GRANT / 8);
            assertEq(market.questionState(1, q).currentYesBps, 5000);
        }
        market.buy(1, 0, true, 100 ether, 150 ether, block.timestamp);
        market.sell(1, 0, true, 50 ether, 1 ether, block.timestamp);
        market.splitPosition(1, 1, 1 ether);
        market.mergePosition(1, 1, 1 ether);
        // These payments acquire or sell real ERC-1155 units on question 0.
        // No user trade changes the game's grant or the backing of another question.
        uint256 id = market.positionId(1, 0, true);
        assertEq(market.balanceOf(address(this), id), 100 ether);
        assertEq(market.totalSupply(id), 100 ether);
        assertEq(market.questionState(1, 0).activeCollateral, GRANT / 8 + 99 ether);
        for (uint8 q = 1; q < 8; ++q) {
            assertEq(market.questionState(1, q).activeCollateral, GRANT / 8);
            assertEq(market.questionState(1, q).currentYesBps, 5000);
        }
        assertEq(market.consumedGameFunding(), GRANT);
        assertEq(market.totalActiveCollateral(), GRANT + 99 ether);
        assertEq(token.balanceOf(address(market)) - market.totalActiveCollateral(), early + late);
        assertEq(market.balanceOf(address(game), market.positionId(1, 0, true)), 0);
        assertEq(token.balanceOf(address(game)), 0);
    }

    function test_quietCyclesCarryExactlyOnceAndProtectOldClaims() public {
        game.setChaosZeroMarket(address(market));
        // Complete-set split is the first operation in cycle one. It must synchronize too.
        market.splitPosition(1, 5, 3 ether);
        market.buy(1, 5, true, 100 ether, 150 ether, block.timestamp);
        _advance();
        _advance();
        _advance();
        assertEq(game.roundNum(), 4);
        assertEq(market.consumedGameFunding(), GRANT);
        token.transfer(address(market), 1);
        vm.expectRevert(GameFundedOutcomeMarket.RoundNotOpen.selector);
        market.syncFunding(2);
        IndependentOutcomeMarket.FundingPreview memory preview = market.fundingPreview(4, 0);
        assertTrue(preview.needsSettlement);
        assertEq(preview.carryUsed, GRANT * 3 - 50 ether);
        assertEq(preview.totalFunding, GRANT * 4 - 50 ether);
        market.buy(4, 1, false, 1 ether, 1 ether, block.timestamp);
        assertEq(market.consumedGameFunding(), GRANT * 4);
        assertTrue(market.roundState(1).settled);
        assertFalse(market.roundState(2).initialized);
        assertFalse(market.roundState(3).initialized);
        assertEq(market.settlementVault().remaining(1, 5), 153 ether);
        assertEq(market.totalActiveCollateral(), preview.totalFunding + 1 ether);
        assertEq(market.mergePosition(1, 5, 3 ether), 3 ether);
        assertEq(market.claimKnown(1), 150 ether);
        assertEq(market.settlementVault().totalEscrowed(), 0);
        assertEq(token.balanceOf(address(market)), market.totalActiveCollateral() + 1);
    }

    function test_exposedLensUsesAuthenticatedCycleFunding() public {
        IndependentOutcomeMarket viewTarget = IndependentOutcomeMarket(address(market));
        game.setChaosZeroMarket(address(market));
        market.splitPosition(1, 0, 1 ether);
        _advance();
        _advance();
        token.transfer(address(market), 7 ether);

        IndependentOutcomeMarket.FundingPreview memory direct = market.fundingPreview(3, 0);
        assertEq(direct.totalFunding, 3 * GRANT);
        assertEq(direct.unallocated, 0);
        assertTrue(direct.needsSettlement);
        assertEq(abi.encode(market.marketViews().fundingPreview(viewTarget, 3, 0)), abi.encode(direct));

        // Resolve the helper before registering an expected revert: the getter is another external call.
        GameFundedMarketViews lens = market.marketViews();
        vm.expectRevert(GameFundedOutcomeMarket.InvalidParameters.selector);
        lens.fundingPreview(viewTarget, 3, 1);
        market.syncFunding(3);
        assertFalse(lens.fundingPreview(viewTarget, 3, 0).canFund);
    }

    function test_invalidOrUnbackedLedgerCannotOpenPools() public {
        game.setChaosZeroMarket(address(market));
        bytes memory query = abi.encodeCall(game.chaosZeroFunding, (address(market), 1));
        vm.mockCall(address(game), query, abi.encode(GRANT, GRANT + 1));
        vm.expectRevert(GameFundedOutcomeMarket.InvalidGameFunding.selector);
        market.syncFunding(1);
        vm.mockCall(address(game), query, abi.encode(GRANT, 2 * GRANT));
        vm.expectRevert(GameFundedOutcomeMarket.InvalidGameFunding.selector);
        market.fundingPreview(1, 0);
        vm.expectRevert(GameFundedOutcomeMarket.InvalidGameFunding.selector);
        market.syncFunding(1);
        vm.clearMockedCalls();
        market.syncFunding(1);
        assertEq(market.totalActiveCollateral(), GRANT);
    }

    function test_largeAccrualReservesCurrentGrantAndDefersExcessCarry() public {
        game.setChaosZeroMarket(address(market));
        uint256 capacity = market.MAX_INITIAL_QUESTION_FUNDING() * 8;
        uint256 cumulative = (capacity / GRANT + 2) * GRANT;
        vm.prank(address(game));
        token.mint(address(market), cumulative - GRANT);
        vm.mockCall(
            address(game), abi.encodeCall(game.chaosZeroFunding, (address(market), 1)), abi.encode(GRANT, cumulative)
        );
        IndependentOutcomeMarket.FundingPreview memory preview = market.fundingPreview(1, 0);
        market.syncFunding(1);
        assertEq(preview.totalFunding, capacity);
        assertEq(preview.carryUsed, capacity - GRANT);
        assertEq(market.pendingCarry(), cumulative - capacity);
        assertEq(market.pendingCarry(), preview.deferredCarry);
        assertEq(market.consumedGameFunding(), cumulative);
        for (uint8 q; q < 8; ++q) {
            assertEq(market.questionState(1, q).activeCollateral, capacity / 8);
        }
    }

    function test_cutoverIsScopedToMarketAndCycleAndKeepsLegacyClaims() public {
        IndependentOutcomeMarket old = new IndependentOutcomeMarket(IIndependentCollateral(address(token)), source);
        token.approve(address(old), type(uint256).max);
        old.fundRound(1, 100 ether);
        old.splitPosition(1, 5, 7 ether);
        _advance();
        game.setChaosZeroMarket(address(market));
        (uint256 earlier,) = game.chaosZeroFunding(address(market), 1);
        (uint256 wrongMarket,) = game.chaosZeroFunding(address(old), 2);
        (uint256 future,) = game.chaosZeroFunding(address(market), 3);
        assertEq(earlier | wrongMarket | future, 0);
        market.syncFunding(2);
        assertEq(old.claimKnown(1), 7 ether);
        assertEq(old.pendingCarry(), 100 ether);
        assertEq(market.totalActiveCollateral(), GRANT);
    }
}
