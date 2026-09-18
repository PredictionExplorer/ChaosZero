// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {SharedOutcomeMarket, ISharedCollateral} from "../src/SharedOutcomeMarket.sol";
import {IOutcomeSource} from "../src/interfaces/IOutcomeSource.sol";
import {MockCst, FalseReturningCst, ReenteringCst, IReentryHook} from "./utils/Mocks.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

contract SharedReentryProbe is IReentryHook, ERC1155Holder {
    SharedOutcomeMarket public market;
    bool public blocked;

    constructor(SharedOutcomeMarket m) {
        market = m;
    }

    function prepare(MockCst token) external {
        token.approve(address(market), type(uint256).max);
        market.buy(1, 0, true, 10e18, 15e18, type(uint256).max);
    }

    function claim() external {
        market.claimKnown(1);
    }

    function onCstReceived() external {
        (bool ok, bytes memory data) = address(market).call(abi.encodeCall(market.claimKnown, (1)));
        blocked = !ok && bytes4(data) == SharedOutcomeMarket.ReentrantCall.selector;
    }
}

contract SharedTaxToken is MockCst {
    bool public tax;

    function setTax(bool value) external {
        tax = value;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        super.transfer(to, amount);
        if (tax && amount > 0) --balanceOf[to];
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        super.transferFrom(from, to, amount);
        if (tax && amount > 0) --balanceOf[to];
        return true;
    }
}

contract SharedCallbackToken is MockCst {
    address public target;
    bytes public payload;
    bool public blocked;
    uint256 public attempts;

    function arm(address target_, bytes memory payload_) external {
        target = target_;
        payload = payload_;
        blocked = false;
        attempts = 0;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        super.transfer(to, amount);
        _attack();
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        super.transferFrom(from, to, amount);
        _attack();
        return true;
    }

    function _attack() private {
        if (target == address(0)) return;
        ++attempts;
        (bool ok, bytes memory data) = target.call(payload);
        blocked = !ok && bytes4(data) == SharedOutcomeMarket.ReentrantCall.selector;
    }
}

contract SharedTestSource is IOutcomeSource {
    struct State {
        bool open;
        bool finalized;
        uint8 known;
        uint8 values;
    }
    mapping(uint256 => State) public states;

    function set(uint256 id, bool open, bool finalized, uint8 known, uint8 values) external {
        states[id] = State(open, finalized, known, values);
    }

    function outcomeState(uint256 id) external view returns (bool, bool, uint8, uint8) {
        State memory s = states[id];
        return (s.open, s.finalized, s.known, s.values);
    }
}

contract SharedOutcomeMarketTest is Test, ERC1155Holder {
    MockCst internal token;
    SharedTestSource internal source;
    SharedOutcomeMarket internal market;
    address internal alice = address(0xa11ce);
    uint256 internal constant ROUND = 1;
    uint256 internal constant SEED = 1_000e18;

    function setUp() public {
        token = new MockCst();
        source = new SharedTestSource();
        market = new SharedOutcomeMarket(ISharedCollateral(address(token)), source);
        token.mint(address(this), 1_000_000e18);
        token.mint(alice, 1_000_000e18);
        token.approve(address(market), type(uint256).max);
        vm.prank(alice);
        token.approve(address(market), type(uint256).max);
        source.set(ROUND, true, false, 0, 0);
        market.fundRound(ROUND, SEED);
    }

    function _buy(uint8 q, bool yes, uint256 cash, uint256 units) internal {
        vm.prank(alice);
        market.buy(ROUND, q, yes, cash, units, type(uint256).max);
    }

    function test_constructorRequiresDeployedTokenAndSourceContracts() public {
        vm.expectRevert(SharedOutcomeMarket.InvalidParameters.selector);
        new SharedOutcomeMarket(ISharedCollateral(address(0)), source);
        vm.expectRevert(SharedOutcomeMarket.InvalidParameters.selector);
        new SharedOutcomeMarket(ISharedCollateral(address(0xbeef)), source);
        vm.expectRevert(SharedOutcomeMarket.InvalidParameters.selector);
        new SharedOutcomeMarket(ISharedCollateral(address(token)), IOutcomeSource(address(0)));
        vm.expectRevert(SharedOutcomeMarket.InvalidParameters.selector);
        new SharedOutcomeMarket(ISharedCollateral(address(token)), IOutcomeSource(address(0xbeef)));
    }

    function _assertSolvent(uint256 id, uint8 mask, uint8 values) internal view {
        (uint256 cash,,,) = market.roundAccounting(id);
        (uint256[8] memory y, uint256[8] memory n) = market.liabilities(id);
        for (uint256 s; s < 256; ++s) {
            if ((s & mask) != values) continue;
            uint256 debt;
            for (uint256 i; i < 8; ++i) {
                debt += (s & (uint256(1) << i)) != 0 ? y[i] : n[i];
            }
            assertGe(cash, debt, "unbacked feasible ending");
        }
    }

    function test_uniformBinaryQuoteMatchesAnalyticInvariant() public {
        // Any one binary basket divides uniform 256 reserves into two groups of128.
        // Its exact fee-free binary quote is net + S - ceil(S*S/(S+net)).
        uint256 cash = 100e18;
        uint256 exact = cash + SEED - (SEED * SEED + SEED + cash - 1) / (SEED + cash);
        // Conservative logarithm enclosure may reject a near-equality by a few wei.
        _buy(0, true, cash, exact - 1_000_000);
        (uint256[8] memory y,) = market.balancesOf(ROUND, alice);
        assertEq(y[0], exact - 1_000_000);
        _assertSolvent(ROUND, 0, 0);
    }

    function test_rejectsOverpricedOutputAndUnbackedOverlap() public {
        vm.expectRevert(SharedOutcomeMarket.ProductWouldDecrease.selector);
        _buy(0, true, 100e18, 200e18);
        vm.expectRevert(SharedOutcomeMarket.Insolvent.selector);
        _buy(0, true, 1e18, SEED + 1e18);
    }

    function test_all256EndingsPayExactEightQuestionClaims() public {
        for (uint8 q; q < 8; ++q) {
            _buy(q, true, 2e18, 3e18);
            _buy(q, false, 2e18, 2e18);
        }
        _assertSolvent(ROUND, 0, 0);
        uint256 snap = vm.snapshotState();
        for (uint256 s; s < 256; ++s) {
            source.set(ROUND, false, true, 255, uint8(s));
            uint256 expected;
            for (uint256 q; q < 8; ++q) {
                expected += (s & (uint256(1) << q)) != 0 ? 3e18 : 2e18;
            }
            uint256 beforeBalance = token.balanceOf(alice);
            vm.prank(alice);
            assertEq(market.claimKnown(ROUND), expected);
            assertEq(token.balanceOf(alice) - beforeBalance, expected);
            vm.prank(alice);
            assertEq(market.claimKnown(ROUND), 0);
            assertTrue(vm.revertToState(snap));
            snap = vm.snapshotState();
        }
    }

    function test_partialAnswerClaimsPreserveAllRemainingReserves() public {
        _buy(0, true, 10e18, 15e18);
        _buy(1, false, 10e18, 15e18);
        source.set(ROUND, true, false, 1, 1);
        vm.prank(alice);
        assertEq(market.claimKnown(ROUND), 15e18);
        (uint256[8] memory y, uint256[8] memory n) = market.balancesOf(ROUND, alice);
        assertEq(y[0], 0);
        assertEq(n[1], 15e18);
        vm.expectRevert(SharedOutcomeMarket.AnswerKnown.selector);
        _buy(0, false, 1e18, 1e18);
        _buy(2, true, 1e18, 1e18);
        _assertSolvent(ROUND, 1, 1);
    }

    function test_finalizedAndClosedCyclesCannotTradeOrReceiveSponsorship() public {
        source.set(ROUND, false, false, 1, 1);
        vm.expectRevert(SharedOutcomeMarket.RoundNotOpen.selector);
        _buy(1, true, 1e18, 1e18);
        source.set(ROUND, false, true, 255, 17);
        vm.expectRevert(SharedOutcomeMarket.RoundNotOpen.selector);
        market.fundRound(ROUND, 1e18);
        vm.expectRevert(SharedOutcomeMarket.RoundNotOpen.selector);
        _buy(1, true, 1e18, 1e18);
    }

    function test_sourceCannotChangeOrForgetCachedAnswer() public {
        source.set(ROUND, true, false, 1, 1);
        market.claimKnown(ROUND);
        source.set(ROUND, true, false, 1, 0);
        vm.expectRevert(SharedOutcomeMarket.InvalidSourceState.selector);
        _buy(1, true, 1e18, 1e18);
        source.set(ROUND, true, false, 0, 0);
        vm.expectRevert(SharedOutcomeMarket.InvalidSourceState.selector);
        market.claimKnown(ROUND);
    }

    function test_repeatedSponsorshipCannotBeBlockedByFirstSponsor() public {
        market.fundRound(ROUND, SEED);
        (uint256 cash,,,) = market.roundAccounting(ROUND);
        assertEq(cash, 2 * SEED);
    }

    function test_directTransfersDoNotChangeAccountingOrClaims() public {
        token.transfer(address(market), 100e18);
        (uint256 cash,,,) = market.roundAccounting(ROUND);
        assertEq(cash, SEED);
        _buy(0, true, 10e18, 15e18);
        source.set(ROUND, false, true, 255, 1);
        vm.prank(alice);
        assertEq(market.claimKnown(ROUND), 15e18);
    }

    function test_rolloverRetainsUnpaidClaimsAndAcceptsPreviouslyFundedDestination() public {
        _buy(0, true, 10e18, 15e18);
        source.set(ROUND, false, true, 255, 1);
        source.set(2, true, false, 0, 0);
        market.fundRound(2, 1e18);
        assertEq(market.rollover(ROUND, 2), SEED - 5e18);
        (uint256 oldCash,,,) = market.roundAccounting(ROUND);
        (uint256 newCash,,,) = market.roundAccounting(2);
        assertEq(oldCash, 15e18);
        assertEq(newCash, SEED - 4e18);
        vm.prank(alice);
        assertEq(market.claimKnown(ROUND), 15e18);
        assertEq(token.balanceOf(address(market)), newCash);
    }

    function test_buySellCannotCreateCashProfitOnUnchangedSource() public {
        _buy(0, true, 10e18, 15e18);
        vm.prank(alice);
        vm.expectRevert(SharedOutcomeMarket.ProductWouldDecrease.selector);
        market.sell(ROUND, 0, true, 15e18, 10e18 + 1e12, type(uint256).max);
        vm.prank(alice);
        market.sell(ROUND, 0, true, 15e18, 5e18, type(uint256).max);
        (uint256[8] memory y,) = market.balancesOf(ROUND, alice);
        assertEq(y[0], 0);
        (uint256 cash,,,) = market.roundAccounting(ROUND);
        assertEq(cash, SEED + 5e18);
    }

    function test_deadlineQuestionAndFundingGuards() public {
        vm.warp(100);
        vm.expectRevert(SharedOutcomeMarket.DeadlineExpired.selector);
        market.buy(ROUND, 0, true, 1, 1, 99);
        vm.expectRevert(SharedOutcomeMarket.InvalidParameters.selector);
        market.buy(ROUND, 8, true, 1, 1, 100);
        uint256 maximum = market.MAX_COLLATERAL();
        vm.expectRevert(SharedOutcomeMarket.InvalidParameters.selector);
        market.fundRound(ROUND, maximum);
    }

    function test_observedClosedRoundCannotReopen() public {
        source.set(ROUND, false, false, 0, 0);
        market.claimKnown(ROUND);
        source.set(ROUND, true, false, 0, 0);
        vm.expectRevert(SharedOutcomeMarket.InvalidSourceState.selector);
        _buy(0, true, 1e18, 1e18);
    }

    function test_inconsistentSourceFinalizationAndUnknownValuesRejected() public {
        source.set(ROUND, true, true, 255, 0);
        vm.expectRevert(SharedOutcomeMarket.InvalidSourceState.selector);
        market.claimKnown(ROUND);
        source.set(ROUND, false, true, 127, 0);
        vm.expectRevert(SharedOutcomeMarket.InvalidSourceState.selector);
        market.claimKnown(ROUND);
        source.set(ROUND, true, false, 0, 1);
        vm.expectRevert(SharedOutcomeMarket.InvalidSourceState.selector);
        market.claimKnown(ROUND);
    }

    function test_falseReturningTokenCannotCreateFundingOrClaims() public {
        FalseReturningCst bad = new FalseReturningCst();
        SharedOutcomeMarket badMarket = new SharedOutcomeMarket(ISharedCollateral(address(bad)), source);
        bad.mint(address(this), SEED);
        bad.approve(address(badMarket), type(uint256).max);
        bad.setFailTransfers(true);
        vm.expectRevert(SharedOutcomeMarket.TransferFailed.selector);
        badMarket.fundRound(ROUND, SEED);
        (uint256 cash, bool funded,,) = badMarket.roundAccounting(ROUND);
        assertEq(cash, 0);
        assertFalse(funded);
    }

    function test_reentrancyCannotDuplicateClaims() public {
        ReenteringCst callback = new ReenteringCst();
        SharedOutcomeMarket m = new SharedOutcomeMarket(ISharedCollateral(address(callback)), source);
        SharedReentryProbe probe = new SharedReentryProbe(m);
        callback.mint(address(this), SEED);
        callback.mint(address(probe), 10e18);
        callback.approve(address(m), type(uint256).max);
        m.fundRound(1, SEED);
        probe.prepare(callback);
        source.set(1, false, true, 255, 1);
        callback.setHook(address(probe));
        probe.claim();
        assertTrue(probe.blocked());
        assertEq(callback.balanceOf(address(probe)), 15e18);
    }

    function test_callbacksDuringEveryTokenPathCannotEnterAnyMutation() public {
        SharedCallbackToken callback = new SharedCallbackToken();
        SharedOutcomeMarket m = new SharedOutcomeMarket(ISharedCollateral(address(callback)), source);
        callback.mint(address(this), 10_000e18);
        callback.approve(address(m), type(uint256).max);
        m.fundRound(1, SEED);
        m.buy(1, 0, true, 10e18, 15e18, type(uint256).max);
        m.splitPosition(1, 2, 1e18);
        m.splitPosition(1, 3, 1e18);
        uint256[8] memory pairs;
        pairs[2] = 1e18;
        pairs[3] = 1e18;
        bytes[8] memory attacks = [
            abi.encodeCall(m.fundRound, (1, 1e12)),
            abi.encodeCall(m.buy, (1, 1, true, 1e18, 1e18, type(uint256).max)),
            abi.encodeCall(m.sell, (1, 0, true, 1e18, 1e17, type(uint256).max)),
            abi.encodeCall(m.claimKnown, (1)),
            abi.encodeCall(m.rollover, (1, 2)),
            abi.encodeCall(m.splitPosition, (1, 4, 1e18)),
            abi.encodeCall(m.mergePosition, (1, 2, 1e18)),
            abi.encodeCall(m.mergePositions, (1, pairs))
        ];
        for (uint256 origin; origin < 7; ++origin) {
            for (uint256 target; target < attacks.length; ++target) {
                uint256 snap = vm.snapshotState();
                callback.arm(address(m), attacks[target]);
                if (origin == 0) {
                    m.fundRound(1, 1e12);
                } else if (origin == 1) {
                    m.buy(1, 1, true, 1e18, 1e18, type(uint256).max);
                } else if (origin == 2) {
                    m.sell(1, 0, true, 1e18, 1e17, type(uint256).max);
                } else if (origin == 3) {
                    source.set(1, false, true, 255, 1);
                    assertEq(m.claimKnown(1), 17e18);
                } else if (origin == 4) {
                    m.splitPosition(1, 4, 1e18);
                } else if (origin == 5) {
                    m.mergePosition(1, 2, 1e18);
                } else {
                    m.mergePositions(1, pairs);
                }
                assertTrue(callback.blocked(), "callback bypassed the global mutation guard");
                assertEq(callback.attempts(), 1);
                (uint256 cash,,,) = m.roundAccounting(1);
                assertEq(callback.balanceOf(address(m)), cash, "callback changed custody");
                assertTrue(vm.revertToState(snap));
            }
        }
    }

    function test_nonExactTokenTransfersRevertWithoutDestroyingBacking() public {
        SharedTaxToken taxed = new SharedTaxToken();
        SharedOutcomeMarket m = new SharedOutcomeMarket(ISharedCollateral(address(taxed)), source);
        taxed.mint(address(this), SEED + 10e18);
        taxed.approve(address(m), type(uint256).max);
        taxed.setTax(true);
        vm.expectRevert(SharedOutcomeMarket.TransferFailed.selector);
        m.fundRound(1, SEED);
        taxed.setTax(false);
        m.fundRound(1, SEED);
        m.buy(1, 0, true, 10e18, 15e18, type(uint256).max);
        source.set(1, false, true, 255, 1);
        taxed.setTax(true);
        vm.expectRevert(SharedOutcomeMarket.TransferFailed.selector);
        m.claimKnown(1);
        (uint256[8] memory y,) = m.balancesOf(1, address(this));
        assertEq(y[0], 15e18);
        assertEq(taxed.balanceOf(address(m)), SEED + 10e18);
    }

    function test_largeCollateralBoundaryAndTinyReserveRemainSafe() public {
        uint256 maximum = market.MAX_COLLATERAL();
        token.mint(address(this), maximum);
        token.mint(alice, maximum);
        source.set(2, true, false, 0, 0);
        market.fundRound(2, maximum / 2);
        vm.prank(alice);
        market.buy(2, 7, true, maximum / 8, maximum / 8, type(uint256).max);
        _assertSolvent(2, 0, 0);
        vm.expectRevert(SharedOutcomeMarket.ProductWouldDecrease.selector);
        vm.prank(alice);
        market.buy(2, 7, true, 1, maximum / 2, type(uint256).max);
    }

    function test_oneWeiWinningReserveIsBackedAndPaysExactly() public {
        uint256 seed = market.MIN_FUNDING();
        uint256 cash = market.MAX_COLLATERAL() / 4;
        token.mint(alice, cash);
        source.set(2, true, false, 0, 0);
        market.fundRound(2, seed);
        vm.prank(alice);
        market.buy(2, 7, true, cash, cash + seed - 1, type(uint256).max);
        _assertSolvent(2, 0, 0);
        source.set(2, false, true, 255, 128);
        vm.prank(alice);
        assertEq(market.claimKnown(2), cash + seed - 1);
        (uint256 residue,,,) = market.roundAccounting(2);
        assertEq(residue, 1);
        source.set(3, true, false, 0, 0);
        market.fundRound(3, seed);
        assertEq(market.rollover(2, 3), 1);
    }

    function testFuzz_partialAnswerTruthTable(uint8 mask, uint8 values) public {
        values &= mask;
        // Distinct exposures on every question; mask selects exactly what can pay.
        for (uint8 q; q < 8; ++q) {
            _buy(q, true, 1e18, 1e18);
        }
        source.set(ROUND, mask != 255, mask == 255, mask, values);
        uint256 expected;
        for (uint256 q; q < 8; ++q) {
            if ((values & (uint256(1) << q)) != 0) expected += 1e18;
        }
        vm.prank(alice);
        assertEq(market.claimKnown(ROUND), expected);
        _assertSolvent(ROUND, mask, values);
    }

    function test_gasFull256StateBuyAndSellUnder32Million() public {
        for (uint8 q; q < 8; ++q) {
            _buy(q, q % 2 == 0, (uint256(q) + 1) * 1e18, (uint256(q) + 1) * 1e18);
        }
        vm.cool(address(market));
        vm.cool(address(token));
        vm.cool(address(source));
        vm.prank(alice);
        uint256 beforeGas = gasleft();
        market.buy(ROUND, 7, true, 10e18, 15e18, type(uint256).max);
        uint256 buyGas = beforeGas - gasleft();
        emit log_named_uint("256-state diverse-reserve buy gas", buyGas);
        assertLt(buyGas, 32_000_000);
        vm.cool(address(market));
        vm.cool(address(token));
        vm.cool(address(source));
        vm.prank(alice);
        beforeGas = gasleft();
        market.sell(ROUND, 7, true, 15e18, 5e18, type(uint256).max);
        uint256 sellGas = beforeGas - gasleft();
        emit log_named_uint("256-state diverse-reserve sell gas", sellGas);
        assertLt(sellGas, 32_000_000);
    }
}
