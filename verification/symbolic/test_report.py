import unittest

from verify import EXPECTED, SUITE, verify_report


def successful_report():
    return {
        "exitcode": 0,
        "test_results": {
            SUITE: [
                {
                    "name": name,
                    "exitcode": 0,
                    "num_models": 0,
                    "num_paths": [count, count, 0],
                    "num_bounded_loops": 0,
                }
                for name, count in EXPECTED.items()
            ]
        },
    }


class ProofReportTest(unittest.TestCase):
    def test_accepts_complete_report(self):
        verify_report(successful_report())

    def test_rejects_missing_replaced_or_duplicate_property(self):
        for count in (0, 1, 2):
            with self.subTest(count=count), self.assertRaises(ValueError):
                report = successful_report()
                rows = report["test_results"][SUITE]
                rows.pop()
                rows.extend([rows[0]] * count)
                verify_report(report)

    def test_rejects_unknown_solver_outcomes_and_incomplete_exploration(self):
        for change in (
            {"exitcode": 1},
            {"exitcode": 2},
            {"exitcode": 3},
            {"exitcode": 4},
            {"num_models": 1},
            {"num_bounded_loops": 1},
            {"num_paths": [1, 0, 0]},
            {"num_paths": [257, 256, 1]},
            {"num_paths": [255, 255, 0]},
        ):
            with self.subTest(change=change), self.assertRaises(ValueError):
                report = successful_report()
                masks = next(
                    r
                    for r in report["test_results"][SUITE]
                    if "everyOutcome" in r["name"]
                )
                masks.update(change)
                verify_report(report)

    def test_rejects_a_failed_run_even_when_individual_rows_are_green(self):
        report = successful_report()
        report["exitcode"] = 1
        with self.assertRaises(ValueError):
            verify_report(report)
