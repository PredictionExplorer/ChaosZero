// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {V3OutcomeSource} from "../src/V3OutcomeSource.sol";
import {ICosmicGameV3} from "../src/interfaces/ICosmicGameV3.sol";
import {IIndependentOutcomeSource} from "../src/interfaces/IIndependentOutcomeSource.sol";
import {IndependentOutcomeMarket, IIndependentCollateral} from "../src/IndependentOutcomeMarket.sol";
import {MockV3Game} from "./utils/MockV3Game.sol";
import {MockCst} from "./utils/Mocks.sol";

contract V3OutcomeSourceTest is Test {
    MockCst private token;
    MockV3Game private game;
    V3OutcomeSource private source;
    V3OutcomeSource.HistoricalBaseline private baseline;

    function setUp() public {
        token = new MockCst();
        game = new MockV3Game(address(token));
        baseline = V3OutcomeSource.HistoricalBaseline(1257, 12 ether, 1000 ether, 400 ether, 8000, 12000, false);
        ICosmicGameV3.RoundStats memory legacy;
        legacy.numBids = 1257;
        game.setStats(2, legacy);
        source = new V3OutcomeSource(game, 3, baseline);
    }

    function test_frozenBaselineHasExplicitProvenanceAndNoInventedZeroHistory() public view {
        assertEq(address(source.game()), address(game));
        assertEq(source.cst(), address(token));
        assertEq(source.firstMarketRound(), 3);
        assertEq(source.baselineHash(), keccak256(abi.encode(address(game), uint256(2), baseline)));
        IIndependentOutcomeSource.Metrics memory m = source.metrics(2);
        assertTrue(m.supported && m.finalized);
        assertEq(m.gestureCount, 1257);
        assertEq(m.ethSpent, 12 ether);
        assertEq(m.cstBurned, 1000 ether);
        assertEq(m.highestCstPaid, 400 ether);
        assertEq(m.enduranceDuration, 8000);
        assertEq(m.chronoDuration, 12000);
        assertFalse(m.sameGesture);
        assertFalse(source.metrics(1).supported);
        assertFalse(source.metrics(4).supported);
    }

    function test_roundIsOpenBeforeFirstGestureAndUntilCounterAdvances() public {
        _assertState(3, true, false, 0, 0);
        ICosmicGameV3.RoundStats memory r = _stats(2000, 20 ether, 2000 ether, 500 ether, 9000, 13000, true);
        game.setStats(3, r);
        game.setChampions(9000, 13000, true);
        vm.warp(type(uint64).max + uint256(1)); // No timestamp dependency, timeout, or historical query.
        _assertState(3, true, false, 0x9f, 0x9f);
        game.setRound(4);
        _assertState(3, false, true, 255, 0xdf);
        _assertState(4, true, false, 0, 0);
    }

    function test_strictTiesResolveNoAndSameGestureUsesFlagNotAddresses() public {
        game.setStats(3, _stats(1257, 12 ether, 1000 ether, 400 ether, 8000, 12000, false));
        game.setChampions(8000, 12000, true); // Same wallet, different winning gestures.
        _assertState(3, true, false, 0, 0);
        game.setRound(4);
        _assertState(3, false, true, 255, 32);
        assertFalse(source.metrics(3).sameGesture);
        ICosmicGameV3.RoundStats memory r = _stats(1258, 12 ether, 1000 ether, 400 ether, 8000, 12000, true);
        game.setStats(3, r);
        _assertState(3, false, true, 255, 65); // Count exceeds the launch count, even parity.
    }

    function test_liveDurationsComeFromCurrentChampionsNotUnsavedRoundFields() public {
        game.setStats(3, _stats(1, 1 ether, 0, 0, 0, 0, false));
        game.setChampions(8001, 12001, false);
        _assertState(3, true, false, 6, 6);
        IIndependentOutcomeSource.Metrics memory m = source.metrics(3);
        assertEq(m.enduranceDuration, 8001);
        assertEq(m.chronoDuration, 12001);
        assertFalse(m.sameGesture);
    }

    function test_nextCycleUsesActualPreviousV3RecordInsteadOfLaunchBaseline() public {
        game.setStats(3, _stats(10, 1 ether, 10 ether, 5 ether, 100, 200, false));
        game.setStats(4, _stats(11, 2 ether, 20 ether, 6 ether, 101, 201, true));
        game.setRound(5);
        _assertState(4, false, true, 255, 255);
    }

    function test_unavailableAndMalformedGameDataFailClosed() public {
        _assertState(0, false, false, 0, 0);
        _assertState(2, false, false, 0, 0);
        _assertState(type(uint256).max, false, false, 0, 0);
        game.setRound(4); // A closed cycle without the mandatory ETH first gesture is not V3 history.
        vm.expectRevert(V3OutcomeSource.InvalidGameState.selector);
        source.outcomeState(3);
        vm.expectRevert(V3OutcomeSource.InvalidGameState.selector);
        source.outcomeState(4);
        game.setRound(3);
        game.setOffline(true);
        vm.expectRevert(MockV3Game.Offline.selector);
        source.outcomeState(3);
    }

    function test_changedTokenOrRolledBackCounterCannotSilentlyChangeTheMarketMeaning() public {
        MockCst otherToken = new MockCst();
        game.setToken(address(otherToken));
        vm.expectRevert(V3OutcomeSource.InvalidGameState.selector);
        source.outcomeState(3);
        vm.expectRevert(V3OutcomeSource.InvalidGameState.selector);
        source.metrics(3);
        game.setToken(address(token));
        game.setRound(2);
        vm.expectRevert(V3OutcomeSource.InvalidGameState.selector);
        source.outcomeState(3);
    }

    function test_constructorRejectsWrongTopologyAndHistoricalCount() public {
        vm.expectRevert(V3OutcomeSource.InvalidConfiguration.selector);
        new V3OutcomeSource(ICosmicGameV3(address(123)), 3, baseline);
        vm.expectRevert(V3OutcomeSource.InvalidConfiguration.selector);
        new V3OutcomeSource(game, 0, baseline);
        vm.expectRevert(V3OutcomeSource.InvalidConfiguration.selector);
        new V3OutcomeSource(game, 4, baseline);
        baseline.gestureCount++;
        vm.expectRevert(V3OutcomeSource.InvalidConfiguration.selector);
        new V3OutcomeSource(game, 3, baseline);
        baseline.gestureCount--;
        game.setToken(address(123));
        vm.expectRevert(V3OutcomeSource.InvalidConfiguration.selector);
        new V3OutcomeSource(game, 3, baseline);
    }

    function test_constructorRejectsFalseNativeBaselineAndBadV3Shape() public {
        game.setStats(2, _stats(1257, 12 ether, 1000 ether, 400 ether, 8000, 12000, false));
        baseline.highestCstPaid++;
        vm.expectRevert(V3OutcomeSource.InvalidConfiguration.selector);
        new V3OutcomeSource(game, 3, baseline);
        baseline.highestCstPaid--;
        new V3OutcomeSource(game, 3, baseline);
        ICosmicGameV3.RoundStats memory r;
        r.numCstBids = 1;
        game.setStats(3, r);
        vm.expectRevert(V3OutcomeSource.InvalidGameState.selector);
        new V3OutcomeSource(game, 3, baseline);
    }

    function testFuzz_allEightFinalBitsMatchIndependentComparisons(uint96[6] memory raw, bool same) public {
        uint256 count = uint256(raw[0]) + 1;
        uint256 ethPaid = uint256(raw[1]) + 1;
        uint256 cstPaid = raw[2];
        uint256 maximum = bound(raw[3], 0, cstPaid);
        game.setStats(3, _stats(count, ethPaid, cstPaid, maximum, raw[4], raw[5], same));
        game.setRound(4);
        uint8 expected;
        if (count > baseline.gestureCount) expected += 1;
        if (raw[4] > baseline.enduranceDuration) expected += 2;
        if (raw[5] > baseline.chronoDuration) expected += 4;
        if (ethPaid > baseline.ethSpent) expected += 8;
        if (cstPaid > baseline.cstBurned) expected += 16;
        if (count % 2 != 0) expected += 32;
        if (same) expected += 64;
        if (maximum > baseline.highestCstPaid) expected += 128;
        _assertState(3, false, true, 255, expected);
    }

    function testFuzz_knownBitsGrowMonotonicallyAndParityCannotBecomeKnownEarly(uint64[6] memory delta) public {
        uint8 previousKnown;
        for (uint256 step; step < 4; ++step) {
            uint256 count = 1 + uint256(delta[0]) * step;
            uint256 ethPaid = 1 + uint256(delta[1]) * step;
            uint256 cstPaid = uint256(delta[2]) * step;
            uint256 endurance = uint256(delta[4]) * step;
            uint256 chrono = uint256(delta[5]) * step;
            // Maximum below total is independently monotone for this generated sequence.
            uint256 maximum = uint256(delta[3]) < delta[2] ? uint256(delta[3]) * step : cstPaid;
            game.setStats(3, _stats(count, ethPaid, cstPaid, maximum, 0, 0, step % 2 == 0));
            game.setChampions(endurance, chrono, step % 2 == 0);
            (bool open, bool finalized, uint8 known, uint8 values) = source.outcomeState(3);
            assertTrue(open);
            assertFalse(finalized);
            assertEq(known & previousKnown, previousKnown);
            assertEq(known & 0x60, 0);
            assertEq(values, known);
            previousKnown = known;
        }
    }

    function testFuzz_nativeLaterRoundComparisonIgnoresLaunchInputs(uint96[6] memory raw) public {
        game.setStats(
            3, _stats(uint256(raw[0]) + 1, uint256(raw[1]) + 1, uint256(raw[2]) + 1, raw[2], raw[4], raw[5], false)
        );
        game.setStats(
            4,
            _stats(
                uint256(raw[0]) + 2,
                uint256(raw[1]) + 2,
                uint256(raw[2]) + 2,
                uint256(raw[2]) + 1,
                uint256(raw[4]) + 1,
                uint256(raw[5]) + 1,
                true
            )
        );
        game.setRound(5);
        _assertState(4, false, true, 255, 0xdf | ((uint256(raw[0]) + 2) % 2 == 1 ? 32 : 0));
    }

    function test_productionSourceMarketSettlementAndRolloverPreserveOldClaims() public {
        IndependentOutcomeMarket market = new IndependentOutcomeMarket(IIndependentCollateral(address(token)), source);
        address alice = address(101);
        token.mint(address(this), 8000 ether);
        token.mint(alice, 100 ether);
        token.approve(address(market), type(uint256).max);
        market.fundRound(3, 8000 ether);
        vm.startPrank(alice);
        token.approve(address(market), type(uint256).max);
        market.buy(3, 0, true, 100 ether, 150 ether, type(uint256).max);
        vm.stopPrank();
        game.setStats(3, _stats(1258, 1 ether, 0, 0, 100, 200, false));
        game.setRound(4);
        market.fundRound(4, 0);
        assertTrue(market.roundState(3).settled);
        assertEq(market.settlementVault().remaining(3, 0), 150 ether);
        for (uint8 q; q < 8; ++q) {
            assertEq(market.questionState(4, q).currentYesBps, 5000);
            assertEq(market.questionState(4, q).activeCollateral, 7950 ether / 8);
        }
        game.setOffline(true);
        vm.prank(alice);
        assertEq(market.claimKnown(3), 150 ether);
        assertEq(token.balanceOf(alice), 150 ether);
        assertEq(market.totalActiveCollateral(), 7950 ether);
    }

    function testFuzz_allQuestionPayoutsTransfersAndRolloverFollowActualSourceBits(
        uint64[8] memory rawCash,
        uint8 finalValues
    ) public {
        IndependentOutcomeMarket market = new IndependentOutcomeMarket(IIndependentCollateral(address(token)), source);
        address alice = address(101);
        address bob = address(102);
        token.mint(address(this), 8000 ether);
        token.mint(alice, 1e30);
        token.approve(address(market), type(uint256).max);
        market.fundRound(3, 8000 ether);
        vm.prank(alice);
        token.approve(address(market), type(uint256).max);
        uint256 spent;
        uint256 aliceOwed;
        uint256 bobOwed;
        uint256[8] memory liabilities;
        for (uint8 q; q < 8; ++q) {
            uint256 cash = bound(rawCash[q], 1e12, 20 ether);
            uint256 units = cash + cash / 2;
            uint256 moved = units / 3;
            bool yes = rawCash[q] % 2 == 0;
            vm.startPrank(alice);
            market.buy(3, q, yes, cash, units, type(uint256).max);
            market.safeTransferFrom(alice, bob, market.positionId(3, q, yes), moved, "");
            vm.stopPrank();
            spent += cash;
            if (yes == ((finalValues & (uint8(1) << q)) != 0)) {
                liabilities[q] = units;
                aliceOwed += units - moved;
                bobOwed += moved;
            }
        }
        uint256 count = (finalValues & 1) != 0 ? 1258 : 1256;
        if ((finalValues & 32) != 0) ++count;
        game.setStats(
            3,
            _stats(
                count,
                (finalValues & 8) != 0 ? baseline.ethSpent + 1 : baseline.ethSpent,
                (finalValues & 16) != 0 ? baseline.cstBurned + 1 : baseline.cstBurned,
                (finalValues & 128) != 0 ? baseline.highestCstPaid + 1 : baseline.highestCstPaid,
                (finalValues & 2) != 0 ? baseline.enduranceDuration + 1 : baseline.enduranceDuration,
                (finalValues & 4) != 0 ? baseline.chronoDuration + 1 : baseline.chronoDuration,
                (finalValues & 64) != 0
            )
        );
        game.setRound(4);
        _assertState(3, false, true, 255, finalValues);
        uint256 carry = 8000 ether + spent - aliceOwed - bobOwed;
        market.fundRound(4, 0);
        for (uint8 q; q < 8; ++q) {
            assertEq(market.settlementVault().remaining(3, q), liabilities[q]);
            assertEq(market.questionState(4, q).currentYesBps, 5000);
            assertEq(market.questionState(4, q).activeCollateral, carry / 8 + (q < carry % 8 ? 1 : 0));
        }
        game.setOffline(true);
        vm.prank(alice);
        assertEq(market.claimKnown(3), aliceOwed);
        vm.prank(bob);
        assertEq(market.claimKnown(3), bobOwed);
        assertEq(token.balanceOf(alice), 1e30 - spent + aliceOwed);
        assertEq(token.balanceOf(bob), bobOwed);
        assertEq(token.balanceOf(address(market)), carry);
        assertEq(market.totalActiveCollateral(), carry);
        assertEq(market.settlementVault().totalEscrowed(), 0);
    }

    function _stats(
        uint256 count,
        uint256 ethPaid,
        uint256 cstPaid,
        uint256 maximum,
        uint256 endurance,
        uint256 chrono,
        bool same
    ) private pure returns (ICosmicGameV3.RoundStats memory r) {
        r.numBids = count;
        r.totalSpentEthAmount = ethPaid;
        r.totalSpentCstAmount = cstPaid;
        r.maxEthBidPrice = ethPaid;
        r.maxCstBidPrice = maximum;
        r.enduranceChampionDuration = endurance;
        r.chronoWarriorDuration = chrono;
        r.flags = same ? 4 : 0;
    }

    function _assertState(uint256 id, bool open, bool finalized, uint8 known, uint8 values) private view {
        (bool actualOpen, bool actualFinalized, uint8 actualKnown, uint8 actualValues) = source.outcomeState(id);
        assertEq(actualOpen, open);
        assertEq(actualFinalized, finalized);
        assertEq(actualKnown, known);
        assertEq(actualValues, values);
    }
}
