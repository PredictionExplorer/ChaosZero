// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {Test} from "forge-std/Test.sol";
import {GestureSeriesMarket} from "../../src/GestureSeriesMarket.sol";
import {ICosmicSignatureGame} from "../../src/ICosmicSignatureGame.sol";
import {MockCst, MockGame} from "../utils/Mocks.sol";

/// @notice Halmos symbolic proofs for GestureSeriesMarket (tools/analysis/halmos.sh).
///
/// Every `check_*` argument is symbolic: Halmos proves each assertion for ALL
/// values allowed by the stated bounds, not for sampled inputs. Amounts are
/// capped at 2^96 wei (about 79 billion CST), far above any realistic
/// position, to keep the solver's bit-vector arithmetic tractable; fee votes
/// range over their full legal domain; thresholds and counts are unbounded.
/// Where a symbolic amount makes a query too hard for the solver, the amount
/// is instead one of a few concrete sizes picked by a symbolic selector, and
/// everything else stays symbolic.
/// A reverting path is not a failure in Halmos, so every step whose SUCCESS
/// is part of the property goes through `_call` and is asserted explicitly.
///
/// `forge test` never runs these (the `check_` prefix is Halmos-only); they
/// are compiled with the rest of the suite so they cannot rot. What is NOT
/// proven here, and why: tools/analysis/README.md#halmos.
contract GestureSeriesMarketSymbolicTest is Test {
    uint256 internal constant ROUND = 5;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant MAX_FEE_BPS = 1_000;
    uint256 internal constant DEAD_SHARES = 1e3;
    uint256 internal constant SEED_LIQUIDITY = 10_000e18;
    uint256 internal constant NO_DEADLINE = type(uint256).max;
    /// @dev Generous ceiling for symbolic CST amounts: 2^96 wei ~ 7.9e10 CST.
    uint256 internal constant MAX_AMOUNT = 2 ** 96;

    address internal constant LP = address(0x1001);
    address internal constant LP2 = address(0x1002);
    address internal constant ALICE = address(0xA11CE);

    MockCst internal cst;
    MockGame internal game;
    GestureSeriesMarket internal market;

    function setUp() public {
        cst = new MockCst();
        game = new MockGame(address(cst));
        game.setRoundNum(ROUND);
        market = new GestureSeriesMarket(ICosmicSignatureGame(address(game)));
        // Unrolled on purpose: Halmos bounds loop unrolling.
        vm.prank(LP);
        cst.approve(address(market), type(uint256).max);
        vm.prank(LP2);
        cst.approve(address(market), type(uint256).max);
        vm.prank(ALICE);
        cst.approve(address(market), type(uint256).max);
    }

    // ---------------------------------------------------------------------
    // Complete sets: exact collateralization
    // ---------------------------------------------------------------------

    /// Minting and redeeming complete sets moves exactly `amount` CST, credits
    /// exactly `amount` YES and `amount` NO, never touches the pool, and
    /// redeeming succeeds exactly when the holder has the pair.
    function check_completeSets_exactCollateralization(uint256 amount, uint256 redeemAmount) public {
        vm.assume(amount > 0 && amount <= MAX_AMOUNT);
        _openPool(800, 200, 5_000);
        (uint256 rY0, uint256 rN0) = _reserves();
        uint256 held0 = cst.balanceOf(address(market));

        cst.mint(ALICE, amount);
        assert(_call(ALICE, abi.encodeCall(GestureSeriesMarket.mintSets, (ROUND, amount))));
        assert(cst.balanceOf(address(market)) == held0 + amount);
        assert(cst.balanceOf(ALICE) == 0);
        (uint256 yes, uint256 no) = market.balancesOf(ROUND, ALICE);
        assert(yes == amount && no == amount);

        bool redeemed = _call(ALICE, abi.encodeCall(GestureSeriesMarket.redeemSets, (ROUND, redeemAmount)));
        assert(redeemed == (redeemAmount > 0 && redeemAmount <= amount));
        uint256 outstanding = redeemed ? amount - redeemAmount : amount;
        assert(cst.balanceOf(address(market)) == held0 + outstanding);
        assert(cst.balanceOf(ALICE) == amount - outstanding);
        (yes, no) = market.balancesOf(ROUND, ALICE);
        assert(yes == outstanding && no == outstanding);

        (uint256 rY, uint256 rN) = _reserves();
        assert(rY == rY0 && rN == rN0);
    }

    // ---------------------------------------------------------------------
    // Resolution
    // ---------------------------------------------------------------------

    /// Once the game has moved past the round, resolution always succeeds and
    /// YES wins if and only if the final count is STRICTLY greater than the
    /// threshold locked from the previous round (a tie is NO).
    function check_resolve_yesIffFinalCountExceedsThreshold(uint256 threshold, uint256 finalCount) public {
        _openPool(threshold, 200, 5_000);
        game.setNumBids(ROUND, finalCount);
        game.setRoundNum(ROUND + 1);

        assert(_call(ALICE, abi.encodeCall(GestureSeriesMarket.resolve, (ROUND))));
        (,, bool resolved, bool yesWon,,,,) = market.roundState(ROUND);
        assert(resolved);
        assert(yesWon == (finalCount > threshold));
    }

    /// While the round is live, `resolve` succeeds exactly when the live count
    /// already exceeds the threshold (YES is certain because counts only
    /// grow), and then always resolves YES; at the same moment betting and
    /// new liquidity halt.
    function check_resolve_earlyOnlyOnceYesIsCertain(uint256 threshold, uint256 liveCount, bool betYes) public {
        _openPool(threshold, 200, 5_000);
        game.setNumBids(ROUND, liveCount);
        bool decided = liveCount > threshold;

        cst.mint(ALICE, 1e18);
        bytes memory bet = betYes
            ? abi.encodeCall(GestureSeriesMarket.betYes, (ROUND, 1e18, 0, NO_DEADLINE))
            : abi.encodeCall(GestureSeriesMarket.betNo, (ROUND, 1e18, 0, NO_DEADLINE));
        assert(_call(ALICE, bet) == !decided);

        assert(_call(ALICE, abi.encodeCall(GestureSeriesMarket.resolve, (ROUND))) == decided);
        (,, bool resolved, bool yesWon,,,,) = market.roundState(ROUND);
        assert(resolved == decided);
        assert(yesWon == decided);
    }

    // ---------------------------------------------------------------------
    // Fee vote
    // ---------------------------------------------------------------------

    /// The pool's fee is the share-weighted average of every live declaration
    /// (the opener's dead shares keep the opener's first vote): through open,
    /// join and re-declaration the ledger is exact, the fee is the floored
    /// average, and it never leaves [min, max] of the declarations, so it
    /// never exceeds the 10% cap. Every fee vote is symbolic; the joiner's
    /// deposit is one of three sizes (see `_joinSize`).
    function check_feeVote_ledgerExactAndAverageWithinDeclarations(
        uint16 openFee,
        uint16 joinFee,
        uint16 revotedFee,
        uint8 joinSize
    ) public {
        vm.assume(openFee <= MAX_FEE_BPS && joinFee <= MAX_FEE_BPS && revotedFee <= MAX_FEE_BPS);
        uint256 joinAmount = _joinSize(joinSize);
        _openPool(800, openFee, 5_000);

        cst.mint(LP2, joinAmount);
        assert(
            _call(
                LP2,
                abi.encodeCall(GestureSeriesMarket.addLiquidity, (ROUND, joinAmount, joinFee, 5_000, 0, NO_DEADLINE))
            )
        );
        assert(_call(LP, abi.encodeCall(GestureSeriesMarket.updateFeeDeclaration, (ROUND, revotedFee))));

        (uint256 lpShares,,) = market.lpPositionOf(ROUND, LP);
        (uint256 lp2Shares,,) = market.lpPositionOf(ROUND, LP2);
        (,, uint256 totalShares,,, uint256 feeWeight, uint256 feeBps) = market.pool(ROUND);
        assert(lp2Shares > 0);
        assert(totalShares == DEAD_SHARES + lpShares + lp2Shares);
        assert(
            feeWeight == DEAD_SHARES * uint256(openFee) + lpShares * uint256(revotedFee) + lp2Shares * uint256(joinFee)
        );
        assert(feeBps == feeWeight / totalShares);
        // min(declarations) <= fee <= max(declarations), without branching on
        // which declaration is the smallest or largest.
        assert(feeBps >= openFee || feeBps >= joinFee || feeBps >= revotedFee);
        assert(feeBps <= openFee || feeBps <= joinFee || feeBps <= revotedFee);
    }

    // ---------------------------------------------------------------------
    // Constant-product bets
    // ---------------------------------------------------------------------

    /// Every bet that goes through, on either side, at any size up to 2^96
    /// and any fee vote, keeps the contract exactly collateralized: CST held
    /// == outstanding complete sets + fee escrow, YES supply == NO supply ==
    /// outstanding sets, the escrow is exactly the declared rate (rounded
    /// down), and the pool absorbs the whole net stake on the side the bettor
    /// sold. How many tokens the bettor receives, and the LPs' fee claims,
    /// depend on divisions the solver cannot finish; they are covered by
    /// fuzzing instead (tools/analysis/README.md#halmos).
    function check_bet_exactCollateralization(uint256 cstIn, uint16 feeBps, bool yes) public {
        vm.assume(cstIn > 0 && cstIn <= MAX_AMOUNT);
        vm.assume(feeBps <= MAX_FEE_BPS);
        _openPool(800, feeBps, 5_000);
        (uint256 rY0, uint256 rN0) = _reserves();

        cst.mint(ALICE, cstIn);
        if (!_call(ALICE, _betCall(yes, cstIn))) return;

        uint256 fee = cstIn * feeBps / BPS;
        uint256 net = cstIn - fee;
        (uint256 rY, uint256 rN,,, uint256 feeReserve,,) = market.pool(ROUND);
        (uint256 aliceYes, uint256 aliceNo) = market.balancesOf(ROUND, ALICE);
        (uint256 lpYes, uint256 lpNo) = market.balancesOf(ROUND, LP);
        uint256 sets = SEED_LIQUIDITY + net;
        assert(rY + aliceYes + lpYes == sets);
        assert(rN + aliceNo + lpNo == sets);
        assert(feeReserve == fee);
        assert(cst.balanceOf(address(market)) == sets + feeReserve);
        if (yes) {
            assert(rN == rN0 + net && aliceNo == 0);
        } else {
            assert(rY == rY0 + net && aliceYes == 0);
        }
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    /// @dev Locks `threshold` for ROUND and opens its pool with the concrete
    /// seed liquidity at the given fee vote and odds.
    function _openPool(uint256 threshold, uint16 feeBps, uint256 probBps) internal {
        game.setNumBids(ROUND - 1, threshold);
        cst.mint(LP, SEED_LIQUIDITY);
        assert(
            _call(
                LP,
                abi.encodeCall(
                    GestureSeriesMarket.addLiquidity, (ROUND, SEED_LIQUIDITY, feeBps, probBps, 0, NO_DEADLINE)
                )
            )
        );
    }

    /// @dev Join deposits for the fee-vote proof: the smallest possible
    /// deposit (one wei, one share), one CST, and the 2^96 amount bound. With
    /// a symbolic deposit the solver faces products of two symbolic 256-bit
    /// values (shares times votes) next to the join's divisions, and does
    /// not finish (tools/analysis/README.md#halmos).
    function _joinSize(uint8 i) internal pure returns (uint256) {
        vm.assume(i < 3);
        if (i == 0) return 1;
        if (i == 1) return 1e18;
        return MAX_AMOUNT;
    }

    function _betCall(bool yes, uint256 cstIn) internal pure returns (bytes memory) {
        return yes
            ? abi.encodeCall(GestureSeriesMarket.betYes, (ROUND, cstIn, 0, NO_DEADLINE))
            : abi.encodeCall(GestureSeriesMarket.betNo, (ROUND, cstIn, 0, NO_DEADLINE));
    }

    function _call(address from, bytes memory data) internal returns (bool ok) {
        vm.prank(from);
        (ok,) = address(market).call(data);
    }

    function _reserves() internal view returns (uint256 rY, uint256 rN) {
        (rY, rN,,,,,) = market.pool(ROUND);
    }
}
