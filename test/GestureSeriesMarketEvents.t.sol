// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {Vm} from "forge-std/Vm.sol";
import {GestureSeriesMarket} from "../src/GestureSeriesMarket.sol";
import {SeriesTestBase} from "./utils/SeriesTestBase.sol";

/// @notice Events are the market's public record: the frontend's activity
/// feed and probability chart are rebuilt from them (decodeScan and
/// replayRound in frontend/src), starting at the deploy block. These tests pin
/// every entry point's EXACT log output — which events, in which order, with
/// which topics and data — and cross-check each payload against the call's
/// return values and the state it changed. A property test then proves the
/// pool-changing events alone reconstruct the pool exactly.
contract GestureSeriesMarketEventsTest is SeriesTestBase {
    // ------------------------------------------------------------------
    // Liquidity
    // ------------------------------------------------------------------

    /// The first deposit of the current round initializes the market, locks
    /// the threshold, then reports the opening deposit.
    function test_events_openingDepositInitializesLocksAndAdds() public {
        vm.recordLogs();
        uint256 shares = _seedPoolWith(lpAda, LIQ, 350, 3_000);
        Vm.Log[] memory logs = _marketLogs(3);
        (uint256 rY, uint256 rN) = _reserves(ROUND);

        _assertLog(logs[0], GestureSeriesMarket.RoundInitialized.selector, bytes32(ROUND), "");
        _assertLog(logs[1], GestureSeriesMarket.ThresholdLocked.selector, bytes32(ROUND), abi.encode(THRESHOLD));
        _assertLog(
            logs[2],
            GestureSeriesMarket.LiquidityAdded.selector,
            bytes32(ROUND),
            _topic(lpAda),
            abi.encode(LIQ, uint16(350), shares, rY, rN)
        );
    }

    /// A future round has no threshold yet: no ThresholdLocked.
    function test_events_futureRoundOpeningLocksNothing() public {
        vm.recordLogs();
        uint256 shares = _seedRoundPool(ROUND + 1, lpAda, LIQ);
        Vm.Log[] memory logs = _marketLogs(2);
        (uint256 rY, uint256 rN) = _reserves(ROUND + 1);

        _assertLog(logs[0], GestureSeriesMarket.RoundInitialized.selector, bytes32(ROUND + 1), "");
        _assertLog(
            logs[1],
            GestureSeriesMarket.LiquidityAdded.selector,
            bytes32(ROUND + 1),
            _topic(lpAda),
            abi.encode(LIQ, FEE, shares, rY, rN)
        );
    }

    /// A join reports exactly what it put into the pool: the reserve deltas.
    function test_events_joinReportsTheExactDeposit() public {
        _seedPool(LIQ);
        vm.prank(carol);
        market.betYes(ROUND, 2_000e18, 0, NO_DEADLINE); // skew the ratio first
        (uint256 rY0, uint256 rN0) = _reserves(ROUND);

        vm.recordLogs();
        vm.prank(lpBen);
        uint256 shares = market.addLiquidity(ROUND, 3_000e18, 450, 0, 0, NO_DEADLINE);
        Vm.Log[] memory logs = _marketLogs(1);
        (uint256 rY1, uint256 rN1) = _reserves(ROUND);

        _assertLog(
            logs[0],
            GestureSeriesMarket.LiquidityAdded.selector,
            bytes32(ROUND),
            _topic(lpBen),
            abi.encode(3_000e18, uint16(450), shares, rY1 - rY0, rN1 - rN0)
        );
    }

    function test_events_removeLiquidityReportsEverythingPaidOut() public {
        uint256 adaShares = _seedPool(LIQ);
        vm.prank(carol);
        market.betNo(ROUND, 1_500e18, 0, NO_DEADLINE); // accrue fees

        vm.recordLogs();
        vm.prank(lpAda);
        (uint256 yesOut, uint256 noOut, uint256 feesOut) =
            market.removeLiquidity(ROUND, adaShares / 3, 0, 0, NO_DEADLINE);
        Vm.Log[] memory logs = _marketLogs(1);

        assertGt(feesOut, 0, "sanity: fees were paid");
        _assertLog(
            logs[0],
            GestureSeriesMarket.LiquidityRemoved.selector,
            bytes32(ROUND),
            _topic(lpAda),
            abi.encode(adaShares / 3, yesOut, noOut, feesOut)
        );
    }

    function test_events_feeVoteReportsOldAndNewDeclaration() public {
        _seedPoolWith(lpAda, LIQ, 120, 5_000);

        vm.recordLogs();
        vm.prank(lpAda);
        market.updateFeeDeclaration(ROUND, 870);
        Vm.Log[] memory logs = _marketLogs(1);

        _assertLog(
            logs[0],
            GestureSeriesMarket.FeeDeclarationUpdated.selector,
            bytes32(ROUND),
            _topic(lpAda),
            abi.encode(uint16(120), uint16(870))
        );
    }

    /// claimFees always logs, including an empty claim (amount 0).
    function test_events_claimFeesLogsEveryClaim() public {
        _seedPool(LIQ);
        vm.prank(carol);
        market.betYes(ROUND, 1_000e18, 0, NO_DEADLINE);

        vm.recordLogs();
        vm.prank(lpAda);
        uint256 fees = market.claimFees(ROUND);
        vm.prank(bob);
        market.claimFees(ROUND); // bob is no LP
        Vm.Log[] memory logs = _marketLogs(2);

        assertGt(fees, 0, "sanity: fees were paid");
        _assertLog(logs[0], GestureSeriesMarket.FeesClaimed.selector, bytes32(ROUND), _topic(lpAda), abi.encode(fees));
        _assertLog(logs[1], GestureSeriesMarket.FeesClaimed.selector, bytes32(ROUND), _topic(bob), abi.encode(0));
    }

    /// Indexer pitfall, pinned: a top-up by an LP with accrued fees pays those
    /// fees out in the same call, yet the market logs only LiquidityAdded (no
    /// FeesClaimed). Off-chain fee-escrow bookkeeping must derive the payout
    /// from the LP's pending fees, or read `pool().feeReserve` from chain.
    function test_events_topUpFeeSettlementIsNotLoggedSeparately() public {
        _seedPool(LIQ);
        vm.prank(carol);
        market.betYes(ROUND, 1_000e18, 0, NO_DEADLINE);
        uint256 pending = _lpPending(ROUND, lpAda);
        uint256 escrowBefore = _feeReserve(ROUND);
        assertGt(pending, 0, "sanity: fees accrued");

        vm.recordLogs();
        vm.prank(lpAda);
        market.addLiquidity(ROUND, 1_000e18, FEE, 0, 0, NO_DEADLINE);
        Vm.Log[] memory logs = _marketLogs(1);

        assertEq(logs[0].topics[0], GestureSeriesMarket.LiquidityAdded.selector);
        assertEq(escrowBefore - _feeReserve(ROUND), pending, "the settlement left the escrow all the same");
    }

    // ------------------------------------------------------------------
    // Betting and sets
    // ------------------------------------------------------------------

    /// A bet reports gross input, net input after the fee, and the fill.
    function test_events_betsReportFeeAndFill() public {
        _seedPoolWith(lpAda, LIQ, 300, 5_000);

        uint256 escrow0 = _feeReserve(ROUND);
        vm.recordLogs();
        vm.prank(alice);
        uint256 yesOut = market.betYes(ROUND, 700e18, 0, NO_DEADLINE);
        Vm.Log[] memory logs = _marketLogs(1);
        uint256 netYes = 700e18 - (_feeReserve(ROUND) - escrow0);
        _assertLog(
            logs[0],
            GestureSeriesMarket.Bet.selector,
            bytes32(ROUND),
            _topic(alice),
            abi.encode(true, 700e18, netYes, yesOut)
        );

        uint256 escrow1 = _feeReserve(ROUND);
        vm.recordLogs();
        vm.prank(bob);
        uint256 noOut = market.betNo(ROUND, 250e18, 0, NO_DEADLINE);
        logs = _marketLogs(1);
        uint256 netNo = 250e18 - (_feeReserve(ROUND) - escrow1);
        _assertLog(
            logs[0],
            GestureSeriesMarket.Bet.selector,
            bytes32(ROUND),
            _topic(bob),
            abi.encode(false, 250e18, netNo, noOut)
        );
    }

    function test_events_setsMintedAndRedeemed() public {
        _seedPool(LIQ);

        vm.recordLogs();
        vm.startPrank(alice);
        market.mintSets(ROUND, 40e18);
        market.redeemSets(ROUND, 15e18);
        vm.stopPrank();
        Vm.Log[] memory logs = _marketLogs(2);

        _assertLog(logs[0], GestureSeriesMarket.SetsMinted.selector, bytes32(ROUND), _topic(alice), abi.encode(40e18));
        _assertLog(logs[1], GestureSeriesMarket.SetsRedeemed.selector, bytes32(ROUND), _topic(alice), abi.encode(15e18));
    }

    // ------------------------------------------------------------------
    // Resolution and claims
    // ------------------------------------------------------------------

    function test_events_resolveReportsFinalCountAndOutcome() public {
        _seedPool(LIQ);
        _endRoundWith(THRESHOLD); // a tie: NO wins

        vm.recordLogs();
        market.resolve(ROUND);
        Vm.Log[] memory logs = _marketLogs(1);

        _assertLog(logs[0], GestureSeriesMarket.Resolved.selector, bytes32(ROUND), abi.encode(THRESHOLD, false));
    }

    function test_events_earlyResolveReportsTheLiveCount() public {
        _seedPool(LIQ);
        game.setNumBids(ROUND, THRESHOLD + 7);

        vm.recordLogs();
        market.resolve(ROUND);
        Vm.Log[] memory logs = _marketLogs(1);

        _assertLog(logs[0], GestureSeriesMarket.Resolved.selector, bytes32(ROUND), abi.encode(THRESHOLD + 7, true));
    }

    /// A round never touched while current locks its threshold at
    /// resolution: ThresholdLocked precedes Resolved in the same call.
    function test_events_lazyResolveLocksThenResolves() public {
        uint256 future = ROUND + 1;
        _seedRoundPool(future, lpAda, LIQ);
        game.setNumBids(ROUND, 640);
        game.setNumBids(future, 641);
        game.setRoundNum(future + 1);

        vm.recordLogs();
        market.resolve(future);
        Vm.Log[] memory logs = _marketLogs(2);

        _assertLog(logs[0], GestureSeriesMarket.ThresholdLocked.selector, bytes32(future), abi.encode(640));
        _assertLog(logs[1], GestureSeriesMarket.Resolved.selector, bytes32(future), abi.encode(641, true));
    }

    /// claim always logs what it paid, including 0 for a losing position.
    function test_events_claimLogsThePayout() public {
        _seedPool(LIQ);
        vm.prank(alice);
        uint256 yesOut = market.betYes(ROUND, 300e18, 0, NO_DEADLINE);
        vm.prank(bob);
        market.betNo(ROUND, 300e18, 0, NO_DEADLINE);
        _endRoundWith(THRESHOLD + 1);
        market.resolve(ROUND);

        vm.recordLogs();
        vm.prank(alice);
        uint256 paid = market.claim(ROUND);
        vm.prank(bob);
        market.claim(ROUND);
        Vm.Log[] memory logs = _marketLogs(2);

        assertEq(paid, yesOut);
        _assertLog(logs[0], GestureSeriesMarket.Claimed.selector, bytes32(ROUND), _topic(alice), abi.encode(yesOut));
        _assertLog(logs[1], GestureSeriesMarket.Claimed.selector, bytes32(ROUND), _topic(bob), abi.encode(0));
    }

    // ------------------------------------------------------------------
    // Event sourcing
    // ------------------------------------------------------------------

    /// Replaying ONLY the pool-changing events (LiquidityAdded,
    /// LiquidityRemoved, Bet) the way the frontend does reproduces the pool's
    /// reserves and share supply exactly, after any interleaving of joins,
    /// top-ups, partial exits, bets both ways, fee re-votes and fee claims.
    function testFuzz_poolEventsReplayToTheExactPool(uint256 seed, uint256 probBps) public {
        vm.recordLogs();
        _seedPoolWith(lpAda, LIQ, FEE, bound(probBps, 100, 9_900));

        for (uint256 i = 0; i < 12; i++) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            uint256 amount = bound(r >> 8, 1e15, 5_000e18);
            address lp = (r >> 128) % 2 == 0 ? lpAda : lpBen;
            uint256 action = r % 6;
            if (action == 0) {
                vm.prank(alice);
                market.betYes(ROUND, amount, 0, NO_DEADLINE);
            } else if (action == 1) {
                vm.prank(bob);
                market.betNo(ROUND, amount, 0, NO_DEADLINE);
            } else if (action == 2 && _joinMintsShares(amount)) {
                vm.prank(lp);
                market.addLiquidity(ROUND, amount, uint16((r >> 64) % (MAX_FEE_BPS + 1)), 0, 0, NO_DEADLINE);
            } else if (action == 3 && _lpShares(ROUND, lp) > 0) {
                uint256 burn = bound(r >> 16, 1, _lpShares(ROUND, lp)); // before the prank: it reads the market
                vm.prank(lp);
                market.removeLiquidity(ROUND, burn, 0, 0, NO_DEADLINE);
            } else if (action == 4) {
                vm.prank(lp);
                market.claimFees(ROUND);
            } else if (action == 5 && _lpShares(ROUND, lp) > 0) {
                vm.prank(lp);
                market.updateFeeDeclaration(ROUND, uint16((r >> 64) % (MAX_FEE_BPS + 1)));
            }
        }

        (uint256 rY, uint256 rN, uint256 shares) = _replayPool(_marketLogs(type(uint256).max));
        (uint256 chainY, uint256 chainN) = _reserves(ROUND);
        assertEq(rY, chainY, "replayed YES reserve");
        assertEq(rN, chainN, "replayed NO reserve");
        assertEq(shares, _totalShares(ROUND), "replayed share supply");
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    /// @dev A join must mint at least one share (a dust pool skewed by big
    /// bets can price a small deposit at zero shares, which reverts).
    function _joinMintsShares(uint256 amount) internal view returns (bool) {
        (uint256 rY, uint256 rN) = _reserves(ROUND);
        return _totalShares(ROUND) * amount / (rY > rN ? rY : rN) > 0;
    }

    /// @dev The frontend's replay model (frontend/src/lib/history.ts).
    function _replayPool(Vm.Log[] memory logs) internal pure returns (uint256 rY, uint256 rN, uint256 shares) {
        for (uint256 i = 0; i < logs.length; i++) {
            bytes32 sig = logs[i].topics[0];
            if (sig == GestureSeriesMarket.LiquidityAdded.selector) {
                (,, uint256 sharesOut, uint256 yesToPool, uint256 noToPool) =
                    abi.decode(logs[i].data, (uint256, uint16, uint256, uint256, uint256));
                if (shares == 0) shares = DEAD_SHARES; // opening deposit
                shares += sharesOut;
                rY += yesToPool;
                rN += noToPool;
            } else if (sig == GestureSeriesMarket.LiquidityRemoved.selector) {
                (uint256 sharesIn, uint256 yesOut, uint256 noOut,) =
                    abi.decode(logs[i].data, (uint256, uint256, uint256, uint256));
                shares -= sharesIn;
                rY -= yesOut;
                rN -= noOut;
            } else if (sig == GestureSeriesMarket.Bet.selector) {
                (bool yes,, uint256 netIn, uint256 tokensOut) =
                    abi.decode(logs[i].data, (bool, uint256, uint256, uint256));
                if (yes) {
                    rY = rY + netIn - tokensOut;
                    rN += netIn;
                } else {
                    rN = rN + netIn - tokensOut;
                    rY += netIn;
                }
            }
        }
    }

    /// @dev The market's logs since the last `vm.recordLogs()`; asserts the
    /// exact count unless `expected` is type(uint256).max.
    function _marketLogs(uint256 expected) internal view returns (Vm.Log[] memory out) {
        Vm.Log[] memory all = vm.getRecordedLogs();
        uint256 n;
        for (uint256 i = 0; i < all.length; i++) {
            if (all[i].emitter == address(market)) n++;
        }
        if (expected != type(uint256).max) assertEq(n, expected, "number of market events");
        out = new Vm.Log[](n);
        n = 0;
        for (uint256 i = 0; i < all.length; i++) {
            if (all[i].emitter == address(market)) out[n++] = all[i];
        }
    }

    function _topic(address a) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(a)));
    }

    function _assertLog(Vm.Log memory log, bytes32 sig, bytes32 topic1, bytes memory data) internal view {
        assertEq(log.emitter, address(market), "emitter");
        assertEq(log.topics.length, 2, "topic count");
        assertEq(log.topics[0], sig, "event signature");
        assertEq(log.topics[1], topic1, "topic 1");
        assertEq(log.data, data, "event data");
    }

    function _assertLog(Vm.Log memory log, bytes32 sig, bytes32 topic1, bytes32 topic2, bytes memory data)
        internal
        view
    {
        assertEq(log.emitter, address(market), "emitter");
        assertEq(log.topics.length, 3, "topic count");
        assertEq(log.topics[0], sig, "event signature");
        assertEq(log.topics[1], topic1, "topic 1");
        assertEq(log.topics[2], topic2, "topic 2");
        assertEq(log.data, data, "event data");
    }
}
