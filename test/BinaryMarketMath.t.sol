// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {BinaryMarketMath} from "../src/libraries/BinaryMarketMath.sol";

contract BinaryMarketMathHarness {
    function verify(
        uint256 beforeC,
        uint256 beforeY,
        uint256 beforeN,
        uint256 afterC,
        uint256 afterY,
        uint256 afterN,
        uint16 p
    ) external pure {
        BinaryMarketMath.verifyProduct(beforeC, beforeY, beforeN, afterC, afterY, afterN, p);
    }

    function marginal(uint256 c, uint256 y, uint256 n, uint16 p) external pure returns (uint16) {
        return BinaryMarketMath.marginalYesBps(c, y, n, p);
    }
}

contract BinaryMarketMathTest is Test {
    BinaryMarketMathHarness private harness;
    uint256 private constant MAX = 1 << 120;

    function setUp() public {
        harness = new BinaryMarketMathHarness();
    }

    function test_uniformPoolHasExactlyEveryAdmissibleInitialProbability() public pure {
        for (uint16 p = 1; p < 10_000; ++p) {
            assertEq(BinaryMarketMath.marginalYesBps(777, 0, 0, p), p);
        }
    }

    function test_directedWeightedQuarterProbabilityBuys() public {
        // Reduced exponents1:3 give exact products800*1100^3>1000^4
        // and750*1100^3<1000^4. This oracle uses no logarithms.
        harness.verify(1000, 0, 0, 1100, 300, 0, 2500);
        vm.expectRevert(BinaryMarketMath.ProductWouldDecrease.selector);
        harness.verify(1000, 0, 0, 1100, 350, 0, 2500);
        assertEq(harness.marginal(1100, 300, 0, 2500), 3142);
        // The same300-unit output is too generous at a75% starting price.
        vm.expectRevert(BinaryMarketMath.ProductWouldDecrease.selector);
        harness.verify(1000, 0, 0, 1100, 300, 0, 7500);
        harness.verify(1000, 0, 0, 1100, 125, 0, 7500);
    }

    function test_exactWeightedEqualityOfPowerOfTwoProductsIsAccepted() public pure {
        // At1:3, 8*2^3 equals1*4^3. All logarithms here are exact integers.
        BinaryMarketMath.verifyProduct(8, 0, 6, 8, 7, 4, 2500);
        BinaryMarketMath.verifyProduct(8, 6, 0, 8, 4, 7, 7500);
        // At the collateral limit, (2^119)^2 equals2^120*2^118.
        BinaryMarketMath.verifyProduct(MAX, MAX / 2, MAX / 2, MAX, 0, MAX - (MAX >> 2), 5000);
    }

    function test_identicalNonPowerFactorsCancelExactlyIncludingNeutralSets() public {
        uint256 reserve = 667601134098543439318150072872112656;
        uint256 c = reserve + 3;
        // This reserve has a two-unit log enclosure. Equal factors must cancel,
        // not be rejected because their separate upper/lower bounds differ.
        harness.verify(c, 3, c - 3, c, 3, c - 3, 9999);
        harness.verify(c, 3, c - 3, c + 100, 103, c + 97, 1);
        harness.verify(c + 100, 103, c + 97, c, 3, c - 3, 1);
        // Keep that large factor fixed while doubling the other reserve.
        harness.verify(c, 3, c - 8, c, 3, c - 16, 9999);
        vm.expectRevert(BinaryMarketMath.ProductWouldDecrease.selector);
        harness.verify(c, 3, c - 8, c, 3, c - 4, 9999);
    }

    function test_unchangedInputsStillRequirePositiveReservesAndValidDomains() public {
        vm.expectRevert(BinaryMarketMath.InvalidCollateral.selector);
        harness.verify(0, 0, 0, 0, 0, 0, 5000);
        vm.expectRevert(BinaryMarketMath.InvalidCollateral.selector);
        harness.verify(MAX + 1, 0, 0, MAX + 1, 0, 0, 5000);
        vm.expectRevert(BinaryMarketMath.NonPositiveReserve.selector);
        harness.verify(100, 100, 0, 100, 100, 0, 5000);
        vm.expectRevert(BinaryMarketMath.NonPositiveReserve.selector);
        harness.verify(100, 0, 101, 100, 0, 101, 5000);
        vm.expectRevert(BinaryMarketMath.NonPositiveReserve.selector);
        harness.verify(100, 0, 0, 100, 100, 0, 5000);
        vm.expectRevert(BinaryMarketMath.InvalidProbability.selector);
        harness.verify(100, 0, 0, 100, 0, 0, 0);
        vm.expectRevert(BinaryMarketMath.InvalidProbability.selector);
        harness.verify(100, 0, 0, 100, 0, 0, 10_000);
        vm.expectRevert(BinaryMarketMath.InvalidProbability.selector);
        harness.marginal(100, 0, 0, type(uint16).max);
    }

    function test_oneWeiReservesMaximumCollateralAndProbabilityExtremes() public pure {
        BinaryMarketMath.verifyProduct(MAX, MAX - 1, MAX - 1, MAX - 100, MAX - 101, MAX - 101, 1);
        BinaryMarketMath.verifyProduct(MAX, MAX - 1, MAX - 1, MAX, MAX - 2, MAX - 2, 9999);
        assertEq(BinaryMarketMath.marginalYesBps(MAX, 0, MAX - 1, 1), 0);
        assertEq(BinaryMarketMath.marginalYesBps(MAX, MAX - 1, 0, 9999), 9999);
        assertEq(BinaryMarketMath.marginalYesBps(1, 0, 0, 1), 1);
        assertEq(BinaryMarketMath.marginalYesBps(1, 0, 0, 9999), 9999);
    }

    function test_exhaustiveSmallWeightedProductsAgainstIntegerOracle() public view {
        for (uint16 weight = 1; weight < 10; ++weight) {
            uint16 p = weight * 1000;
            for (uint256 a = 1; a <= 4; ++a) {
                for (uint256 b = 1; b <= 4; ++b) {
                    for (uint256 c = 1; c <= 4; ++c) {
                        for (uint256 d = 1; d <= 4; ++d) {
                            uint256 beforeProduct = a ** weight * b ** (10 - weight);
                            uint256 afterProduct = c ** weight * d ** (10 - weight);
                            bool accepted = _accepted(a, b, c, d, p);
                            if (afterProduct < beforeProduct) assertFalse(accepted);
                            // Products are <=4^10: strict gaps here are much wider
                            // than the conservative logarithm interval precision.
                            if (afterProduct > beforeProduct) assertTrue(accepted);
                            if (a == c && b == d) assertTrue(accepted);
                        }
                    }
                }
            }
        }
    }

    function testFuzz_neverAcceptsDecreasingExactWeightedProduct(
        uint256 a,
        uint256 b,
        uint256 c,
        uint256 d,
        uint16 rawWeight
    ) public view {
        a = bound(a, 1, 1 << 24);
        b = bound(b, 1, 1 << 24);
        c = bound(c, 1, 1 << 24);
        d = bound(d, 1, 1 << 24);
        uint16 weight = 1 + rawWeight % 9;
        // Reduced exponent sum10 keeps exact products below2^240.
        uint256 beforeProduct = a ** weight * b ** (10 - weight);
        uint256 afterProduct = c ** weight * d ** (10 - weight);
        bool accepted = _accepted(a, b, c, d, weight * 1000);
        if (accepted) assertGe(afterProduct, beforeProduct);
        if (afterProduct < beforeProduct) assertFalse(accepted);
    }

    function testFuzz_allPriorsMatchExactPowerOfTwoOracle(uint8 a, uint8 b, uint8 c, uint8 d, uint16 rawP) public view {
        a %= 121;
        b %= 121;
        c %= 121;
        d %= 121;
        uint16 p = 1 + rawP % 9999;
        uint256 beforeExponent = uint256(p) * a + uint256(10_000 - p) * b;
        uint256 afterExponent = uint256(p) * c + uint256(10_000 - p) * d;
        assertEq(
            _accepted(uint256(1) << a, uint256(1) << b, uint256(1) << c, uint256(1) << d, p),
            afterExponent >= beforeExponent
        );
    }

    function testFuzz_splitMergeReserveInvariance(
        uint256 rawC,
        uint256 rawY,
        uint256 rawN,
        uint256 rawExtra,
        uint16 rawP
    ) public pure {
        uint256 c = bound(rawC, 1, MAX);
        uint256 y = bound(rawY, 0, c - 1);
        uint256 n = bound(rawN, 0, c - 1);
        uint256 extra = bound(rawExtra, 0, MAX - c);
        uint16 p = 1 + rawP % 9999;
        BinaryMarketMath.verifyProduct(c, y, n, c + extra, y + extra, n + extra, p);
        BinaryMarketMath.verifyProduct(c + extra, y + extra, n + extra, c, y, n, p);
        assertEq(
            BinaryMarketMath.marginalYesBps(c, y, n, p),
            BinaryMarketMath.marginalYesBps(c + extra, y + extra, n + extra, p)
        );
    }

    function testFuzz_marginalIsExactRationalFloorAndSymmetric(uint256 a, uint256 b, uint16 rawP) public pure {
        a = bound(a, 1, MAX);
        b = bound(b, 1, MAX);
        uint16 p = 1 + rawP % 9999;
        uint256 c = a > b ? a : b;
        uint256 result = BinaryMarketMath.marginalYesBps(c, c - a, c - b, p);
        uint256 numerator = uint256(p) * b * 10_000;
        uint256 denominator = uint256(p) * b + uint256(10_000 - p) * a;
        assertLe(result * denominator, numerator);
        assertGt((result + 1) * denominator, numerator);
        uint256 complement = BinaryMarketMath.marginalYesBps(c, c - b, c - a, 10_000 - p);
        assertGe(result + complement, 9999);
        assertLe(result + complement, 10_000);
    }

    function testFuzz_verifyIsSymmetric(uint256 a, uint256 b, uint256 c, uint256 d, uint16 rawP) public view {
        a = bound(a, 1, MAX);
        b = bound(b, 1, MAX);
        c = bound(c, 1, MAX);
        d = bound(d, 1, MAX);
        uint16 p = 1 + rawP % 9999;
        assertEq(_accepted(a, b, c, d, p), _accepted(b, a, d, c, 10_000 - p));
    }

    function test_weightedVerificationGasRemainsBounded() public {
        uint256 beforeGas = gasleft();
        harness.verify(1000e18, 123e18, 219e18, 1025e18, 133e18, 219e18, 4321);
        uint256 used = beforeGas - gasleft();
        emit log_named_uint("weighted binary invariant verification gas", used);
        assertLt(used, 120_000);
    }

    function _accepted(uint256 a, uint256 b, uint256 c, uint256 d, uint16 p) private view returns (bool accepted) {
        uint256 beforeC = a > b ? a : b;
        uint256 afterC = c > d ? c : d;
        bytes memory data;
        (accepted, data) = address(harness)
            .staticcall(
                abi.encodeCall(harness.verify, (beforeC, beforeC - a, beforeC - b, afterC, afterC - c, afterC - d, p))
            );
        if (!accepted) assertEq(data, abi.encodeWithSelector(BinaryMarketMath.ProductWouldDecrease.selector));
    }
}
