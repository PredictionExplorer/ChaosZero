"""Compare a fresh V4 Slither run to the reviewed high/medium findings."""

import json
import os
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MARKET = "src/GameFundedOutcomeMarket.sol"
VIEWS = "src/GameFundedMarketViews.sol"
BASELINE = Path(__file__).with_name("reviewed.json")


def verify_findings(report, reviewed):
    if report["success"] is not True or report.get("error"):
        raise ValueError("Slither did not complete the analysis")
    detectors = report["results"].get("detectors", [])
    if not isinstance(detectors, list):
        raise TypeError("Invalid Slither results")

    def fingerprint(row):
        return row["impact"], row["check"], row["id"]

    expected = Counter(fingerprint(row) for row in reviewed)
    if any(n != 1 for n in expected.values()):
        raise ValueError("Duplicate reviewed findings")
    actual = Counter(fingerprint(row) for row in detectors)
    if expected != actual:
        raise ValueError(
            f"Unreviewed findings: {list((actual - expected).elements())}\n"
            f"Missing reviewed findings: {list((expected - actual).elements())}"
        )


def main():
    artifact_dir = ROOT / ".local/static"
    artifact_dir.mkdir(parents=True, exist_ok=True)
    report_path = artifact_dir / "results.json"
    report_path.unlink(missing_ok=True)
    # The executable beside this interpreter comes from the same hashed lock.
    slither = Path(sys.executable).with_name("slither")
    with tempfile.TemporaryDirectory(dir=artifact_dir) as temp:
        build = Path(temp)
        env = dict(os.environ, FOUNDRY_PROFILE="default")
        subprocess.run(
            [
                "forge",
                "build",
                "--ast",
                "--build-info",
                "--out",
                build / "out",
                "--cache-path",
                build / "cache",
                "--build-info-path",
                build / "info",
                MARKET,
                VIEWS,
            ],
            cwd=ROOT,
            env=env,
            check=True,
        )
        (build_info,) = (build / "info").glob("*.json")
        compilation = json.loads(build_info.read_text())
        for path in (MARKET, VIEWS):
            if not compilation["output"]["sources"][path]["ast"]["nodes"]:
                raise ValueError(f"Missing compiler AST for {path}")
        subprocess.run(
            [
                slither,
                ".",
                "--compile-force-framework",
                "foundry",
                "--ignore-compile",
                "--foundry-build-info-directory",
                build / "info",
                "--include-paths",
                r"src/GameFunded(OutcomeMarket|MarketViews)\.sol$",
                "--exclude-dependencies",
                "--exclude-low",
                "--exclude-informational",
                "--exclude-optimization",
                "--fail-none",
                "--json",
                report_path,
            ],
            cwd=ROOT,
            env=env,
            check=True,
        )
    reviewed = json.loads(BASELINE.read_text())
    verify_findings(json.loads(report_path.read_text()), reviewed)
    print(
        f"Matched {len(reviewed)} reviewed findings across the V4 market and read helper."
    )


if __name__ == "__main__":
    main()
