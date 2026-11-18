"""Execute the complete V4 Halmos suite with a fresh, isolated Forge build."""

import json
import os
import subprocess
import sys
import tempfile
from importlib.metadata import version
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SUITE = "test/symbolic/GameFundedSymbolic.t.sol:GameFundedSymbolicTest"
# Minimum number of normally returning routes (one for each distinct first
# action, terminal mask, or payout choice where applicable).
EXPECTED = {
    "check_onlyAuthenticatedGrant(uint96)": 1,
    "check_reusedLedgerCannotFundAnotherCycle(uint64)": 1,
    "check_allOpeningPathsCreditOnce(uint8)": 3,
    "check_quietGrantsConsumedExactlyOnce(uint8,uint64)": 1,
    "check_carryAtCapacitySurvivesRepeatedSync(uint8)": 1,
    "check_everyOutcomeEscrowsAllWinningUnits(uint8)": 256,
    "check_lateClaimsSurviveNewCycles(uint64,uint64,uint64,bool)": 2,
}


def verify_report(report):
    suites = report["test_results"]
    if report["exitcode"] != 0 or set(suites) != {SUITE}:
        raise ValueError("Halmos did not complete the expected test suite")
    rows = suites[SUITE]
    if len(rows) != len(EXPECTED) or {row["name"] for row in rows} != set(EXPECTED):
        raise ValueError("Missing, duplicate, or unexpected symbolic properties")
    for row in rows:
        name = row["name"]
        total, returned, blocked = row["num_paths"]
        if (
            row["exitcode"] != 0
            or row["num_models"] != 0
            or row["num_bounded_loops"] != 0
            or blocked != 0
            or not total >= returned >= EXPECTED[name]
        ):
            raise ValueError(f"Incomplete or failed proof: {name}")


def main():
    if version("halmos") != "0.3.3" or version("z3-solver") != "4.12.6.0":
        raise SystemExit(
            "Install the hash-locked verification/symbolic/requirements.txt"
        )
    # Let Halmos invoke the Z3 binary installed by the same Python environment.
    env = {
        **os.environ,
        "PATH": str(Path(sys.executable).parent) + os.pathsep + os.environ["PATH"],
    }
    forge = subprocess.check_output(
        ["forge", "--version"], text=True, env=env
    ).splitlines()[0]
    if forge.split()[2].split("-")[0] != "1.7.1":
        raise SystemExit(f"Expected Foundry 1.7.1; got {forge}")

    reports = ROOT / ".local/symbolic"
    reports.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=reports, prefix="build-") as temp:
        out = Path(temp) / "out"
        result_file = Path(temp) / "results.json"
        env.update(
            FOUNDRY_PROFILE="default",
            FOUNDRY_TEST="test/symbolic",
            FOUNDRY_OUT=str(out),
            FOUNDRY_CACHE_PATH=str(Path(temp) / "cache"),
        )
        config = json.loads(
            subprocess.check_output(["forge", "config", "--json"], cwd=ROOT, env=env)
        )
        expected = {
            "solc": "0.8.35",
            "optimizer": True,
            "optimizer_runs": 1_000_000,
            "via_ir": True,
            "evm_version": "osaka",
        }
        if any(config[key] != value for key, value in expected.items()):
            raise SystemExit("Proofs require the V4 production compiler settings")
        # A fresh artifact directory also prevents removed tests from silently passing.
        process = subprocess.run(
            [
                sys.executable,
                "-m",
                "halmos",
                "--root",
                ".",
                "--forge-build-out",
                str(out),
                "--contract",
                "GameFundedSymbolicTest",
                "--function",
                "check_",
                "--loop",
                "18",
                "--solver",
                "z3",
                "--solver-threads",
                "2",
                "--solver-timeout-assertion",
                "300s",
                "--panic-error-codes",
                "*",
                "--no-status",
                "--json-output",
                str(result_file),
            ],
            cwd=ROOT,
            env=env,
            check=False,
        )
        try:
            process.check_returncode()
            report = json.loads(result_file.read_text())
            verify_report(report)
        except (
            OSError,
            ValueError,
            KeyError,
            TypeError,
            subprocess.CalledProcessError,
        ):
            if result_file.is_file():
                failed = reports / f"results-failed-{Path(temp).name}.json"
                result_file.replace(failed)
                print(f"Failed run preserved at {failed}", file=sys.stderr)
            raise
        result_file.replace(reports / "results.json")
    rows = [
        f"| `{r['name']}` | {r['num_paths'][1]} | {r['num_paths'][0]} |"
        for r in report["test_results"][SUITE]
    ]
    summary = "\n".join(
        [
            "### V4 symbolic verification",
            "",
            "| Proved property | Normal paths | All explored paths |",
            "| --- | ---: | ---: |",
            *rows,
        ]
    )
    print(summary)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a") as output:
            print(summary, file=output)


if __name__ == "__main__":
    main()
