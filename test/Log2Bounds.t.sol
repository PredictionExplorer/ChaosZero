// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;
import {Test} from "forge-std/Test.sol";
import {Log2Bounds} from "../src/libraries/Log2Bounds.sol";

contract Log2BoundsTest is Test {
    function test_exactAllPowersOfTwo() public pure {
        for (uint256 i; i <= 120; ++i) {
            (uint256 lo, uint256 hi) = Log2Bounds.bounds(uint256(1) << i);
            assertEq(lo, i << 64);
            assertEq(hi, lo);
        }
    }

    function test_adversarialDyadicBoundaryRegression() public pure {
        (uint256 lo, uint256 hi) = Log2Bounds.bounds(667601134098543439318150072872112656);
        assertEq(lo, 2195281890161561960447);
        assertEq(hi, 2195281890161561960449);
    }

    function test_independentHighPrecisionVectors() public pure {
        // Bounds below were generated independently with Python Decimal, 200 digits.
        (uint256 lo, uint256 hi) = Log2Bounds.bounds(3);
        assertLe(lo, 29237397617229858719);
        assertGe(hi, 29237397617229858720);
        (lo, hi) = Log2Bounds.bounds(10);
        assertLe(lo, 61278757397652712441);
        assertGe(hi, 61278757397652712442);
    }

    function testFuzz_logRespectsIntegerPowerBounds(uint256 value) public pure {
        value = bound(value, 1, uint256(1) << 120);
        (uint256 lo, uint256 hi) = Log2Bounds.bounds(value);
        uint256 e = Log2Bounds.mostSignificantBit(value);
        assertGe(lo, e << 64);
        assertLe(hi, (e + 1) << 64);
        assertGe(hi, lo);
        // A diagnostic precision bound, not an assumption used for safety.
        assertLe(hi - lo, 4);
    }

    function testFuzz_enclosedDoublingIsExactShift(uint256 value) public pure {
        value = bound(value, 1, uint256(1) << 119);
        (uint256 lo, uint256 hi) = Log2Bounds.bounds(value);
        (uint256 doubleLo, uint256 doubleHi) = Log2Bounds.bounds(value * 2);
        assertEq(doubleLo, lo + (uint256(1) << 64));
        assertEq(doubleHi, hi + (uint256(1) << 64));
    }

    function testFuzz_acceptedLogComparisonPreservesExactSmallProduct(
        uint256[4] memory before_,
        uint256[4] memory after_
    ) public pure {
        uint256 oldProduct = 1;
        uint256 newProduct = 1;
        uint256 oldUpper;
        uint256 newLower;
        for (uint256 i; i < 4; ++i) {
            // Four factors below 10^18 have an exact product below 2^240.
            before_[i] = bound(before_[i], 1, 1e18);
            after_[i] = bound(after_[i], 1, 1e18);
            oldProduct *= before_[i];
            newProduct *= after_[i];
            (, uint256 upper) = Log2Bounds.bounds(before_[i]);
            (uint256 lower,) = Log2Bounds.bounds(after_[i]);
            oldUpper += upper;
            newLower += lower;
        }
        if (newLower >= oldUpper) assertGe(newProduct, oldProduct);
    }
}
