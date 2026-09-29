#!/usr/bin/env bash
# Symbolic proofs of the market's key properties with Halmos: every
# `check_*` function in test/halmos/ is proven for ALL inputs within its
# stated bounds, against the production bytecode (FOUNDRY_PROFILE=halmos
# inherits the deployed compiler settings).
#
#   tools/analysis/halmos.sh [extra halmos flags, e.g. --function check_bet]
#
# Exits non-zero on any counterexample, error, solver timeout, or proof left
# incomplete by a loop bound. Writes .analysis/halmos/{results.json,
# summary.md,halmos.log}; the build goes to .analysis/halmos/forge-out so the
# default out/ is left alone.

# shellcheck source=tools/analysis/_common.sh
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
cd "$ANALYSIS_ROOT" || exit 1

pinned=$(pinned_version HALMOS_VERSION 0.3.3)
require halmos "Install it with: pipx install halmos==$pinned"
require forge "Install Foundry $(pinned_version FOUNDRY_VERSION 1.8.3) with foundryup."
check_version halmos "$(halmos --version | awk '{print $NF}')" "$pinned"

out="$ANALYSIS_OUT/halmos"
mkdir -p "$out"
rm -f "$out/results.json"

export FOUNDRY_PROFILE=halmos
# Halmos runs every *SymbolicTest artifact in the build directory, and forge
# keeps artifacts of deleted or renamed test files, so always build afresh
# (the profile's own out/cache, never the default ones).
forge clean
status=0
halmos --root . --forge-build-out .analysis/halmos/forge-out \
  --config tools/analysis/halmos.toml \
  --json-output "$out/results.json" "$@" 2>&1 | tee "$out/halmos.log" || status=$?

# A property only counts as proved when every path was explored: a loop cut
# off at Halmos's unrolling bound turns a PASS into an incomplete proof.
report=0
python3 - "$out/results.json" "$status" "$out/summary.md" <<'PY' || report=$?
import json
import sys

path, status, summary_path = sys.argv[1], int(sys.argv[2]), sys.argv[3]
VERDICTS = {0: "proved", 1: "COUNTEREXAMPLE", 2: "solver timeout", 3: "stuck", 4: "all paths revert", 5: "error"}
try:
    results = json.load(open(path)).get("test_results") or {}
    tests = [t for ts in results.values() for t in ts]
except (OSError, ValueError):
    tests = []

rows, incomplete = [], []
for t in tests:
    name = t.get("name", "?").split("(")[0]
    verdict = VERDICTS.get(t.get("exitcode"), f"exit {t.get('exitcode')}")
    if t.get("exitcode") == 0 and t.get("num_bounded_loops"):
        verdict = "INCOMPLETE (bounded loop)"
        incomplete.append(name)
    paths = (t.get("num_paths") or ["?"])[0]
    secs = (t.get("time") or [0])[0]
    rows.append(f"| `{name}` | {verdict} | {paths} | {secs:.1f} |")

ok = status == 0 and bool(tests) and not incomplete
if ok:
    headline = f":white_check_mark: all {len(tests)} properties proved"
else:
    headline = f":x: halmos exited {status}"
    if incomplete:
        headline += f"; incomplete: {', '.join(incomplete)}"
lines = ["### Halmos symbolic proofs", "", f"{headline}.", ""]
if rows:
    lines += ["| Property | Result | Paths | Time (s) |", "| --- | --- | ---: | ---: |", *rows]
with open(summary_path, "w") as f:
    f.write("\n".join(lines) + "\n")
sys.exit(0 if ok else 1)
PY

cat "$out/summary.md"
step_summary <"$out/summary.md"
if [[ $status -eq 0 && $report -ne 0 ]]; then status=1; fi
exit "$status"
