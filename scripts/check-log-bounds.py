#!/usr/bin/env python3
"""Check Solidity-produced Q64 log bounds using an independent Decimal oracle.

This does not reproduce the contract's normalization/squaring algorithm. Python's
correctly rounded Decimal.ln supplies an independent 170-digit reference. Adjacent
representable values enclose each natural logarithm, then directed division and
multiplication enclose log2(x) * 2**64. The Solidity interval must contain that
whole reference interval; there is no empirical epsilon or tolerated violation.
Exact powers of two use exact integer arithmetic instead of rounded logarithms.

This checks a deterministic finite corpus, not a universal mathematical proof.
"""

import argparse
import copy
import json
import re
import subprocess
import sys
import tempfile
import unittest
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR, ROUND_HALF_EVEN, localcontext
from pathlib import Path

PRECISION = 170
SCALE = 1 << 64
MAX_INPUT = 1 << 120
MIN_LOG_ROWS = 631
ADVERSARIAL_INPUT = 667601134098543439318150072872112656
ROOT = Path(__file__).resolve().parent.parent
DEFAULT_FIXTURE = ROOT / "frontend/src/test/fixtures/shared-contract-vectors.json"


def unsigned_integer(value, field):
    if not isinstance(value, str) or re.fullmatch(r"[0-9]+", value) is None:
        raise ValueError(f"{field} must be an unsigned decimal integer string")
    return int(value)


def reference_interval(value):
    if not 1 <= value <= MAX_INPUT:
        raise ValueError("input is outside the supported 1..2**120 domain")
    if value & (value - 1) == 0:
        exact = Decimal((value.bit_length() - 1) * SCALE)
        return exact, exact
    with localcontext() as context:
        context.prec = PRECISION
        context.rounding = ROUND_HALF_EVEN
        numerator = Decimal(value).ln()
        denominator = Decimal(2).ln()
        # Decimal.ln is correctly rounded. One adjacent representable value on
        # each side therefore encloses the exact logarithm, including ties.
        numerator_low = numerator.next_minus()
        numerator_high = numerator.next_plus()
        denominator_low = denominator.next_minus()
        denominator_high = denominator.next_plus()
        context.rounding = ROUND_FLOOR
        lower = numerator_low / denominator_high * Decimal(SCALE)
        context.rounding = ROUND_CEILING
        upper = numerator_high / denominator_low * Decimal(SCALE)
        return lower, upper


def verify_log_row(row):
    value = unsigned_integer(row.get("input"), "input")
    lower = unsigned_integer(row.get("lower"), "lower")
    upper = unsigned_integer(row.get("upper"), "upper")
    if lower > upper:
        raise ValueError(f"input {value}: lower endpoint exceeds upper endpoint")
    reference_lower, reference_upper = reference_interval(value)
    if Decimal(lower) > reference_lower:
        raise ValueError(f"input {value}: lower endpoint is above the independent reference")
    if Decimal(upper) < reference_upper:
        raise ValueError(f"input {value}: upper endpoint is below the independent reference")
    return value


def required_inputs():
    values = {ADVERSARIAL_INPUT}
    for exponent in range(121):
        power = 1 << exponent
        values.update(
            value for value in (power - 1, power, power + 1) if 1 <= value <= MAX_INPUT
        )
    return values


def verify_fixture(path):
    rows = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(rows, list):
        raise ValueError("fixture must be an array")
    logs = []
    for row in rows:
        if not isinstance(row, dict) or row.get("kind") not in {"log", "trade"}:
            raise ValueError("fixture contains an unrecognized vector")
        if row["kind"] == "log":
            logs.append(row)
    if len(logs) < MIN_LOG_ROWS:
        raise ValueError(
            f"incomplete log corpus: expected at least {MIN_LOG_ROWS}, got {len(logs)}"
        )
    seen = {verify_log_row(row) for row in logs}
    missing = required_inputs() - seen
    if missing:
        raise ValueError(
            f"log corpus omits {len(missing)} required power/neighbor/regression inputs"
        )
    return len(logs), len(seen)


class OracleTests(unittest.TestCase):
    def setUp(self):
        self.three = {
            "kind": "log",
            "input": "3",
            "lower": "29237397617229858719",
            "upper": "29237397617229858720",
        }

    def test_all_exact_powers(self):
        for exponent in range(121):
            exact = str(exponent * SCALE)
            self.assertEqual(
                verify_log_row({"input": str(1 << exponent), "lower": exact, "upper": exact}),
                1 << exponent,
            )

    def test_non_integer_logarithm_is_enclosed(self):
        self.assertEqual(verify_log_row(self.three), 3)
        lower, upper = reference_interval(3)
        self.assertLess(lower, upper)
        self.assertGreater(lower, Decimal(self.three["lower"]))
        self.assertLess(upper, Decimal(self.three["upper"]))

    def test_one_unit_lower_corruption_fails(self):
        row = {**self.three, "lower": self.three["upper"]}
        with self.assertRaisesRegex(ValueError, "lower endpoint"):
            verify_log_row(row)

    def test_one_unit_upper_corruption_fails(self):
        row = {**self.three, "upper": self.three["lower"]}
        with self.assertRaisesRegex(ValueError, "upper endpoint"):
            verify_log_row(row)

    def test_exact_power_corruption_fails(self):
        for lower, upper in ((SCALE + 1, SCALE + 1), (SCALE - 1, SCALE - 1)):
            with self.assertRaises(ValueError):
                verify_log_row({"input": "2", "lower": str(lower), "upper": str(upper)})

    def test_invalid_domain_and_lossy_input_types_fail(self):
        for value in ("0", str(MAX_INPUT + 1), "-1", "1.5", 3, True):
            with self.subTest(value=value), self.assertRaises(ValueError):
                verify_log_row({**self.three, "input": value})

    def test_empty_corpus_cannot_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = Path(directory) / "empty.json"
            fixture.write_text("[]", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "incomplete log corpus"):
                verify_fixture(fixture)

    def test_cli_fails_for_corrupted_lower_and_upper(self):
        rows = json.loads(DEFAULT_FIXTURE.read_text(encoding="utf-8"))
        index = next(
            i for i, row in enumerate(rows)
            if row.get("kind") == "log" and row["input"] == "3"
        )
        for endpoint, other in (("lower", "upper"), ("upper", "lower")):
            with self.subTest(endpoint=endpoint), tempfile.TemporaryDirectory() as directory:
                damaged = copy.deepcopy(rows)
                damaged[index][endpoint] = damaged[index][other]
                fixture = Path(directory) / "damaged.json"
                fixture.write_text(json.dumps(damaged), encoding="utf-8")
                result = subprocess.run(
                    [sys.executable, str(Path(__file__).resolve()), str(fixture)],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                self.assertEqual(result.returncode, 1)
                self.assertIn(f"{endpoint} endpoint", result.stderr)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("fixture", nargs="?", type=Path, default=DEFAULT_FIXTURE)
    parser.add_argument(
        "--self-test", action="store_true", help="run oracle corruption regression tests"
    )
    args = parser.parse_args()
    if args.self_test:
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(OracleTests)
        return 0 if unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful() else 1
    try:
        count, distinct = verify_fixture(args.fixture)
    except (ValueError, OSError, KeyError) as error:
        print(f"Log-bound verification failed: {error}", file=sys.stderr)
        return 1
    print(
        f"Verified {count} Solidity log intervals ({distinct} distinct inputs) "
        f"against independent {PRECISION}-digit Decimal references."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
