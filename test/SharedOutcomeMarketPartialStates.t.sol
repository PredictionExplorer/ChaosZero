// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {SharedOutcomeMarket, ISharedCollateral} from "../src/SharedOutcomeMarket.sol";
import {SharedTestSource} from "./SharedOutcomeMarket.t.sol";
import {MockCst} from "./utils/Mocks.sol";

/// @notice Exhaust all 3^8 assignments of unknown / known NO / known YES.
/// Nine prefixes partition the cases into bounded-gas tests of 729 cases each.
contract SharedOutcomeMarketPartialStatesTest is Test {
    SharedOutcomeMarket private market;
    SharedTestSource private source;
    MockCst private token;
    address private constant ALICE = address(0xa11ce);
    address private constant BOB = address(0xb0b);
    uint256 private initialCash;
    uint256[8] private initialYes;
    uint256[8] private initialNo;

    function setUp() public {
        token = new MockCst();
        source = new SharedTestSource();
        source.set(1, true, false, 0, 0);
        market = new SharedOutcomeMarket(ISharedCollateral(address(token)), source);
        token.mint(address(this), 1000e18);
        token.approve(address(market), type(uint256).max);
        market.fundRound(1, 1000e18);
        token.mint(ALICE, 1000e18);
        token.mint(BOB, 1000e18);
        vm.startPrank(ALICE);
        token.approve(address(market), type(uint256).max);
        for (uint8 q; q < 8; ++q) {
            uint256 yes = (uint256(q) + 1) * 1e18;
            uint256 no = (uint256(q) + 9) * 1e18;
            market.buy(1, q, true, yes, yes, type(uint256).max);
            market.buy(1, q, false, no, no, type(uint256).max);
        }
        vm.stopPrank();
        vm.startPrank(BOB);
        token.approve(address(market), type(uint256).max);
        market.buy(1, 3, true, 5e18, 5e18, type(uint256).max);
        market.buy(1, 7, false, 7e18, 7e18, type(uint256).max);
        vm.stopPrank();
        (initialCash,,,) = market.roundAccounting(1);
        (initialYes, initialNo) = market.liabilities(1);
    }

    function test_allPartialAssignments_prefix0() public {
        _partition(0);
    }

    function test_allPartialAssignments_prefix1() public {
        _partition(1);
    }

    function test_allPartialAssignments_prefix2() public {
        _partition(2);
    }

    function test_allPartialAssignments_prefix3() public {
        _partition(3);
    }

    function test_allPartialAssignments_prefix4() public {
        _partition(4);
    }

    function test_allPartialAssignments_prefix5() public {
        _partition(5);
    }

    function test_allPartialAssignments_prefix6() public {
        _partition(6);
    }

    function test_allPartialAssignments_prefix7() public {
        _partition(7);
    }

    function test_allPartialAssignments_prefix8() public {
        _partition(8);
    }

    function _partition(uint256 prefix) private {
        for (uint256 suffix; suffix < 729; ++suffix) {
            uint256 snap = vm.snapshotState();
            _case(prefix + 9 * suffix);
            assertTrue(vm.revertToStateAndDelete(snap));
        }
    }

    function _case(uint256 ternary) private {
        uint8 mask;
        uint8 values;
        uint256 payout;
        uint256[8] memory expectedYes;
        uint256[8] memory expectedNo;
        for (uint256 q; q < 8; ++q) {
            uint256 state = ternary % 3;
            ternary /= 3;
            uint8 bit = uint8(uint256(1) << q);
            if (state == 0) {
                expectedYes[q] = (q + 1) * 1e18;
                expectedNo[q] = (q + 9) * 1e18;
            } else {
                mask |= bit;
                if (state == 2) {
                    values |= bit;
                    payout += (q + 1) * 1e18;
                } else {
                    payout += (q + 9) * 1e18;
                }
            }
        }
        source.set(1, mask != 255, mask == 255, mask, values);
        uint256 beforeAlice = token.balanceOf(ALICE);
        vm.prank(ALICE);
        assertEq(market.claimKnown(1), payout, "wrong independently calculated payout");
        assertEq(token.balanceOf(ALICE), beforeAlice + payout);
        (uint256[8] memory aliceYes, uint256[8] memory aliceNo) = market.balancesOf(1, ALICE);
        (uint256[8] memory bobYes, uint256[8] memory bobNo) = market.balancesOf(1, BOB);
        (uint256[8] memory aggregateYes, uint256[8] memory aggregateNo) = market.liabilities(1);
        for (uint256 q; q < 8; ++q) {
            assertEq(aliceYes[q], expectedYes[q], "unknown YES altered or known YES uncleared");
            assertEq(aliceNo[q], expectedNo[q], "unknown NO altered or known NO uncleared");
            assertEq(bobYes[q], q == 3 ? 5e18 : 0, "other holder YES changed");
            assertEq(bobNo[q], q == 7 ? 7e18 : 0, "other holder NO changed");
            assertEq(aggregateYes[q], expectedYes[q] + bobYes[q]);
            assertEq(aggregateNo[q], expectedNo[q] + bobNo[q]);
        }
        (uint256 cash,, uint8 cachedMask, uint8 cachedValues) = market.roundAccounting(1);
        assertEq(cash, initialCash - payout);
        assertEq(cash, token.balanceOf(address(market)));
        assertEq(cachedMask, mask);
        assertEq(cachedValues, values);
        for (uint256 ending; ending < 256; ++ending) {
            if ((ending & mask) != values) continue;
            uint256 oldDebt;
            uint256 newDebt;
            for (uint256 q; q < 8; ++q) {
                bool yes = (ending & (uint256(1) << q)) != 0;
                oldDebt += yes ? initialYes[q] : initialNo[q];
                newDebt += yes ? aggregateYes[q] : aggregateNo[q];
            }
            assertGe(cash, newDebt);
            assertEq(cash - newDebt, initialCash - oldDebt, "feasible reserve changed during claim");
        }
    }
}
