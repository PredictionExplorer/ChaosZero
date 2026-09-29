// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {IndependentOutcomeMarket, IIndependentCollateral} from "../src/IndependentOutcomeMarket.sol";
import {IIndependentOutcomeSource} from "../src/interfaces/IIndependentOutcomeSource.sol";
import {LocalCosmicGame} from "../src/local/LocalCosmicGame.sol";
import {LocalCst} from "../src/local/LocalCst.sol";
import {LocalOutcomeSource} from "../src/local/LocalOutcomeSource.sol";
import {MockCst} from "./utils/Mocks.sol";

contract RoundEndSource is IIndependentOutcomeSource {
    struct State {
        bool open;
        bool finalized;
        uint8 known;
        uint8 values;
        uint256 start;
        uint256 end;
    }
    mapping(uint256 => State) private states;

    function set(uint256 id, bool open, bool finalized, uint8 known, uint8 values, uint256 start, uint256 end)
        external
    {
        states[id] = State(open, finalized, known, values, start, end);
    }

    function outcomeState(uint256 id) external view returns (bool, bool, uint8, uint8) {
        State memory s = states[id];
        return (s.open, s.finalized, s.known, s.values);
    }

    function cycleTimes(uint256 id) external view returns (uint256, uint256) {
        return (states[id].start, states[id].end);
    }
}

/// @notice Markets never end early. Known answers (even all eight), an elapsed countdown
/// and an elapsed claim timeout leave every trading, splitting, merging and funding entry
/// point live; only the game's round-ending transaction closes a cycle, and no payout
/// precedes that closure.
contract IndependentRoundEndTest is Test, ERC1155Holder {
    IndependentOutcomeMarket private market;
    RoundEndSource private source;
    MockCst private token;
    uint256 private constant SEED = 8000e18;
    uint8 private constant VALUES = 0xa5;

    event RoundFunded(
        uint256 indexed roundId,
        address indexed caller,
        uint256 donated,
        uint256 transfersUsed,
        uint256 carryUsed,
        uint256[8] allocations
    );

    function setUp() public {
        // The real local simulator contracts refuse any other chain.
        vm.chainId(31337);
        vm.warp(100);
        token = new MockCst();
        source = new RoundEndSource();
        source.set(0, false, true, 0xff, 0, 0, 100);
        source.set(1, true, false, 0, 0, 100, 0);
        market = new IndependentOutcomeMarket(IIndependentCollateral(address(token)), source);
        token.mint(address(this), 1e40);
        token.approve(address(market), type(uint256).max);
        market.fundRound(1, SEED);
    }

    function test_allEightAnswersKnownWhileOpenKeepsEveryEntryPointLiveUntilFinalized() public {
        source.set(1, true, false, 0xff, VALUES, 100, 0);

        // Both sides of every question still trade. units == cash leaves the bought
        // side's reserve unchanged and grows the other, so each buy is accepted.
        for (uint8 q; q < 8; ++q) {
            IndependentOutcomeMarket.QuestionView memory before_ = market.questionState(1, q);
            market.buy(1, q, true, 10e18, 10e18, type(uint256).max);
            market.buy(1, q, false, 10e18, 10e18, type(uint256).max);
            IndependentOutcomeMarket.QuestionView memory after_ = market.questionState(1, q);
            assertEq(after_.activeCollateral, before_.activeCollateral + 20e18);
            assertEq(after_.yesSupply, before_.yesSupply + 10e18);
            assertEq(after_.noSupply, before_.noSupply + 10e18);
        }
        uint256 cashBefore = token.balanceOf(address(this));
        market.sell(1, 0, true, 1e18, 1e15, type(uint256).max);
        assertEq(token.balanceOf(address(this)), cashBefore + 1e15);

        for (uint8 q; q < 8; ++q) {
            market.splitPosition(1, q, 2e18);
        }
        cashBefore = token.balanceOf(address(this));
        assertEq(market.mergePosition(1, 0, 1e18), 1e18);
        uint256[8] memory pairs;
        for (uint8 q; q < 8; ++q) {
            pairs[q] = 1e18;
        }
        assertEq(market.mergePositions(1, pairs), 8e18);
        assertEq(token.balanceOf(address(this)), cashBefore + 9e18);

        // An explicit gift, a bare trigger for a direct transfer, and a trade absorbing one.
        uint256 active = market.totalActiveCollateral();
        market.fundRound(1, 8e18);
        assertEq(market.totalActiveCollateral(), active + 8e18);
        token.transfer(address(market), 2e18);
        uint256[8] memory allocations;
        for (uint8 q; q < 8; ++q) {
            allocations[q] = 2e18 / 8;
        }
        vm.expectEmit(true, true, false, true, address(market));
        emit RoundFunded(1, address(this), 0, 2e18, 0, allocations);
        market.fundRound(1, 0);
        active = market.totalActiveCollateral();
        token.transfer(address(market), 1e18);
        market.buy(1, 3, true, 5e18, 5e18, type(uint256).max);
        assertEq(market.totalActiveCollateral(), active + 1e18 + 5e18);

        IndependentOutcomeMarket.RoundView memory r = market.roundState(1);
        assertEq(r.knownMask, 0xff);
        assertEq(r.values, VALUES);
        assertFalse(r.closed);
        assertFalse(r.finalized);
        assertFalse(r.settled);
        for (uint8 q; q < 8; ++q) {
            uint16 price = market.questionState(1, q).currentYesBps;
            assertGt(price, 0);
            assertLt(price, 10_000);
        }

        // Knowing every answer never authorizes a payout.
        vm.expectRevert(IndependentOutcomeMarket.NotFinalized.selector);
        market.claimKnown(1);
        vm.expectRevert(IndependentOutcomeMarket.NotFinalized.selector);
        market.settleRound(1);
        (bool claimable, uint256 total,) = market.previewClaim(1, address(this));
        assertFalse(claimable);
        assertEq(total, 0);
        (bool ready, uint256 escrowed, uint256 carried) = market.previewSettlement(1);
        assertFalse(ready);
        assertEq(escrowed, 0);
        assertEq(carried, 0);

        // The round-ending transaction is the cutoff, effective in the same block.
        vm.warp(200);
        source.set(1, false, true, 0xff, VALUES, 100, 200);
        vm.expectRevert(IndependentOutcomeMarket.RoundNotOpen.selector);
        market.buy(1, 1, true, 1e18, 1e18, type(uint256).max);
        vm.expectRevert(IndependentOutcomeMarket.RoundNotOpen.selector);
        market.sell(1, 1, true, 1e18, 1e15, type(uint256).max);
        vm.expectRevert(IndependentOutcomeMarket.RoundNotOpen.selector);
        market.splitPosition(1, 1, 1e18);
        vm.expectRevert(IndependentOutcomeMarket.RoundNotOpen.selector);
        market.fundRound(1, 1e18);
        vm.expectRevert(IndependentOutcomeMarket.RoundNotOpen.selector);
        market.fundRound(1, 0);

        cashBefore = token.balanceOf(address(this));
        assertEq(market.mergePosition(1, 1, 1e18), 1e18);
        assertEq(token.balanceOf(address(this)), cashBefore + 1e18);

        uint256 expected;
        for (uint8 q; q < 8; ++q) {
            bool yesWins = (VALUES >> q) & 1 == 1;
            expected += market.balanceOf(address(this), market.positionId(1, q, yesWins));
        }
        market.settleRound(1);
        (claimable, total,) = market.previewClaim(1, address(this));
        assertTrue(claimable);
        assertEq(total, expected);
        cashBefore = token.balanceOf(address(this));
        assertEq(market.claimKnown(1), expected);
        assertEq(token.balanceOf(address(this)), cashBefore + expected);
    }

    function test_realGameRoundEndIsTheOnlyMarketCutoff() public {
        vm.warp(100_000);
        LocalCosmicGame game = new LocalCosmicGame();
        LocalOutcomeSource local = new LocalOutcomeSource(game);
        LocalCst cst = game.token();
        IndependentOutcomeMarket live = new IndependentOutcomeMarket(IIndependentCollateral(address(cst)), local);
        cst.faucet(1_000_000 ether);
        cst.approve(address(live), type(uint256).max);
        live.fundRound(1, SEED);

        address bidder = makeAddr("bidder");
        vm.deal(bidder, 10 ether);
        // The replayed baseline has six gestures; a seventh ETH gesture makes
        // "more gestures" and "more ETH spent" known YES while the cycle runs.
        for (uint256 i; i < 7; ++i) {
            uint256 price = game.getNextEthPrice();
            vm.prank(bidder);
            game.bidEth{value: price}();
        }
        (bool open, bool finalized, uint8 known, uint8 values) = local.outcomeState(1);
        assertTrue(open);
        assertFalse(finalized);
        assertEq(known & 9, 9);
        assertEq(values & 9, 9);
        live.buy(1, 0, true, 10e18, 10e18, type(uint256).max);

        // Neither the countdown nor the claim timeout closes the market.
        uint256[2] memory checkpoints = [game.mainPrizeTime(), game.mainPrizeTime() + game.CLAIM_TIMEOUT() + 1 hours];
        for (uint256 i; i < checkpoints.length; ++i) {
            vm.warp(checkpoints[i]);
            _exerciseEveryEntryPoint(live);
            (open, finalized, known,) = local.outcomeState(1);
            assertTrue(open);
            assertFalse(finalized);
        }
        // The elapsed clock made the timing comparisons known too; still trading.
        assertEq(known & 6, 6);
        assertEq(live.roundState(1).knownMask, known);

        // Not the last bidder: allowed only because the claim timeout has elapsed.
        game.closeCycle();
        vm.expectRevert(IndependentOutcomeMarket.RoundNotOpen.selector);
        live.buy(1, 0, true, 1e18, 1e18, type(uint256).max);
        vm.expectRevert(IndependentOutcomeMarket.RoundNotOpen.selector);
        live.splitPosition(1, 0, 1e18);
        vm.expectRevert(IndependentOutcomeMarket.RoundNotOpen.selector);
        live.fundRound(1, 1e18);

        (open, finalized, known, values) = local.outcomeState(1);
        assertFalse(open);
        assertTrue(finalized);
        assertEq(known, 0xff);
        uint256 expected;
        for (uint8 q; q < 8; ++q) {
            bool yesWins = (values >> q) & 1 == 1;
            expected += live.balanceOf(address(this), live.positionId(1, q, yesWins));
        }
        live.settleRound(1);
        uint256 cashBefore = cst.balanceOf(address(this));
        assertEq(live.claimKnown(1), expected);
        assertEq(cst.balanceOf(address(this)), cashBefore + expected);

        (open,,,) = local.outcomeState(2);
        assertTrue(open);
        uint256 carry = live.pendingCarry();
        assertGt(carry, 0);
        live.buy(2, 0, true, 1e18, 1e18, type(uint256).max);
        assertTrue(live.roundState(2).funded);
        assertEq(live.pendingCarry(), 0);
    }

    function test_localRoundWithEveryEarlyKnowableAnswerKnownStaysOpenPastTheTimers() public {
        vm.warp(100_000);
        LocalCosmicGame game = new LocalCosmicGame();
        LocalOutcomeSource local = new LocalOutcomeSource(game);
        LocalCst cst = game.token();
        IndependentOutcomeMarket live = new IndependentOutcomeMarket(IIndependentCollateral(address(cst)), local);
        cst.faucet(1_000_000 ether);
        cst.approve(address(live), type(uint256).max);
        live.fundRound(1, SEED);
        vm.deal(address(this), 10 ether);
        for (uint256 i; i < 5; ++i) {
            game.bidEth{value: game.getNextEthPrice()}();
        }
        game.bidCst(type(uint256).max); // 400 CST beats the baseline's 300 CST peak.
        game.bidCst(type(uint256).max); // 1,200 CST burned beats the baseline's 600.
        vm.warp(game.mainPrizeTime() + game.CLAIM_TIMEOUT() + 1 hours);
        (bool open, bool finalized, uint8 known,) = local.outcomeState(1);
        // Every answer except parity (5) and same-gesture (6) is already decided.
        assertEq(known, 0x9f);
        assertTrue(open, "known answers and elapsed timers never close a round");
        assertFalse(finalized);
        _exerciseEveryEntryPoint(live);
        game.closeCycle();
        vm.expectRevert(IndependentOutcomeMarket.RoundNotOpen.selector);
        live.buy(1, 0, true, 1e18, 1e18, type(uint256).max);
    }

    function test_aClosedButUnfinalizedReportStopsTradingAndPaysNothing() public {
        // A round the source does not report open (here a future one) never trades.
        vm.expectRevert(IndependentOutcomeMarket.RoundNotOpen.selector);
        market.splitPosition(2, 0, 1e18);
        vm.expectRevert(IndependentOutcomeMarket.RoundNotOpen.selector);
        market.fundRound(2, SEED);
        // A contract-violating closed-but-unfinalized report closes trading and still
        // pays nothing: trading needs `open`, payouts need `finalized`.
        source.set(1, false, false, 0xff, VALUES, 100, 0);
        vm.expectRevert(IndependentOutcomeMarket.RoundNotOpen.selector);
        market.buy(1, 0, true, 1e18, 1e18, type(uint256).max);
        vm.expectRevert(IndependentOutcomeMarket.RoundNotOpen.selector);
        market.sell(1, 0, true, 1e18, 1, type(uint256).max);
        vm.expectRevert(IndependentOutcomeMarket.RoundNotOpen.selector);
        market.splitPosition(1, 0, 1e18);
        vm.expectRevert(IndependentOutcomeMarket.RoundNotOpen.selector);
        market.fundRound(1, 1e18);
        vm.expectRevert(IndependentOutcomeMarket.NotFinalized.selector);
        market.settleRound(1);
        vm.expectRevert(IndependentOutcomeMarket.NotFinalized.selector);
        market.claimKnown(1);
    }

    function testFuzz_consistentKnownMasksNeverCloseAnOpenCycle(
        uint8 known,
        uint8 rawValues,
        uint8 q,
        bool yes,
        uint256 rawCash
    ) public {
        uint8 values = rawValues & known;
        uint256 cash = bound(rawCash, 1e18, 100e18);
        q %= 8;
        source.set(1, true, false, known, values, 100, 0);
        market.buy(1, q, yes, cash, cash, type(uint256).max);
        market.splitPosition(1, q, cash);
        IndependentOutcomeMarket.RoundView memory r = market.roundState(1);
        assertEq(r.knownMask, known);
        assertEq(r.values, values);
        assertFalse(r.closed);
        uint16 price = market.questionState(1, q).currentYesBps;
        assertGt(price, 0);
        assertLt(price, 10_000);
        vm.expectRevert(IndependentOutcomeMarket.NotFinalized.selector);
        market.claimKnown(1);
    }

    function _exerciseEveryEntryPoint(IndependentOutcomeMarket live) private {
        live.buy(1, 1, false, 10e18, 10e18, type(uint256).max);
        live.sell(1, 1, false, 1e18, 1e15, type(uint256).max);
        live.splitPosition(1, 2, 3e18);
        assertEq(live.mergePosition(1, 2, 1e18), 1e18);
        live.fundRound(1, 8e18);
        IndependentOutcomeMarket.RoundView memory r = live.roundState(1);
        assertFalse(r.closed);
        assertFalse(r.finalized);
    }
}
