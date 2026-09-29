// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {GestureSeriesMarket, IERC20} from "../src/GestureSeriesMarket.sol";
import {ICosmicSignatureGame} from "../src/ICosmicSignatureGame.sol";
import {ArbitrumForkTest, ArbitrumOne} from "./utils/ArbitrumOne.sol";

/// @notice Validates our minimal interface against the live Cosmic Signature
/// proxy on Arbitrum One and runs a full LP + bet flow against a fresh series
/// market deployed on a fork. Reported as SKIPPED unless ARBITRUM_RPC_URL is set:
///
///   ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc forge test --match-contract Fork -vv
contract ForkTest is ArbitrumForkTest {
    address constant GAME = ArbitrumOne.GAME;
    address constant CST = ArbitrumOne.CST;

    function test_fork_liveGameInterfaceAndMarketFlow() external {
        _forkArbitrumOneOrSkip();

        ICosmicSignatureGame game = ICosmicSignatureGame(GAME);
        assertEq(game.token(), CST, "token() getter");
        uint256 round = game.roundNum();
        emit log_named_uint("live roundNum", round);
        emit log_named_uint("threshold (previous round's count)", round > 0 ? game.bidderAddresses(round - 1) : 0);
        emit log_named_uint("gestures so far this round", game.bidderAddresses(round));
        // Series markets start at round 1 (round 0 has no previous round).
        vm.skip(round == 0, "live game still in round 0");

        GestureSeriesMarket market = new GestureSeriesMarket(game);

        deal(CST, address(this), 10_000e18);
        IERC20(CST).approve(address(market), type(uint256).max);

        // The live count may already exceed the previous round's; then the
        // outcome is decided and the market correctly refuses to open.
        uint256 threshold = game.bidderAddresses(round - 1);
        uint256 current = game.bidderAddresses(round);
        if (current > threshold) {
            vm.expectRevert(GestureSeriesMarket.OutcomeDecided.selector);
            market.addLiquidity(round, 1_000e18, 200, 5_000, 0, type(uint256).max);
            emit log("Outcome already decided this round: init correctly refused");
            return;
        }

        market.addLiquidity(round, 1_000e18, 200, 5_000, 0, type(uint256).max);
        (bool initialized, bool thresholdKnown,,, uint256 storedThreshold,,,) = market.roundState(round);
        assertTrue(initialized);
        assertTrue(thresholdKnown, "current-round threshold locks at init");
        assertEq(storedThreshold, threshold, "threshold read from the live game");
        assertEq(market.currentFeeBps(round), 200, "sole LP's declaration is the fee");

        uint256 quoted = market.quoteBetYes(round, 100e18);
        uint256 out = market.betYes(round, 100e18, quoted, type(uint256).max);
        assertEq(out, quoted, "fork bet must match its quote");
        assertGt(out, 0);

        // Future rounds are open for business against the LIVE game too.
        uint256 future = round + 1;
        market.addLiquidity(future, 500e18, 200, 5_000, 0, type(uint256).max);
        (, bool futureKnown,,,,,,) = market.roundState(future);
        assertFalse(futureKnown, "a future round has no threshold yet");
        uint256 futureOut = market.betYes(future, 50e18, 0, type(uint256).max);
        assertGt(futureOut, 0, "future-round bet fills");
        vm.expectRevert(GestureSeriesMarket.NotResolvable.selector);
        market.resolve(future);
    }
}
