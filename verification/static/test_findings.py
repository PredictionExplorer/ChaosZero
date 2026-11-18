import unittest

from check import verify_findings


class TriageTests(unittest.TestCase):
    def setUp(self):
        self.reviewed = [{"impact": "High", "check": "balance", "id": "original"}]
        self.report = {"success": True, "results": {"detectors": self.reviewed.copy()}}

    def test_reviewed(self):
        verify_findings(self.report, self.reviewed)

    def test_different_location_same_severity_and_detector(self):
        self.report["results"]["detectors"][0] = dict(self.reviewed[0], id="elsewhere")
        with self.assertRaisesRegex(ValueError, "Unreviewed"):
            verify_findings(self.report, self.reviewed)

    def test_missing_and_duplicate_results(self):
        for rows in ([], self.reviewed * 2):
            self.report["results"]["detectors"] = rows
            with self.assertRaises(ValueError):
                verify_findings(self.report, self.reviewed)

    def test_unsuccessful_run_with_matching_output(self):
        self.report["success"] = False
        with self.assertRaises(ValueError):
            verify_findings(self.report, self.reviewed)
