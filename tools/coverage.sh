#!/usr/bin/env bash
# Coverage gate for the contracts in src/.
#
#   tools/coverage.sh            run `forge coverage`, then enforce the thresholds
#   tools/coverage.sh --no-run   only re-check an existing lcov.info
#
# Writes lcov.info at the repository root (git-ignored; upload it to any
# coverage service as-is: it only contains src/). Fails unless, over src/:
#
#   lines     >= COVERAGE_MIN_LINES      (default 100)
#   functions >= COVERAGE_MIN_FUNCTIONS  (default 100)
#   branches  >= COVERAGE_MIN_BRANCHES   (default 98.27, i.e. 57 of 58)
#
# The one branch that is never taken is the zero-reserve guard in
# GestureSeriesMarket._joinPool, which is provably unreachable: an opened pool
# keeps its dead shares forever and neither reserve can reach zero (proved by
# invariant_openedPoolsNeverClose in test/GestureSeriesMarketInvariant.t.sol).
# Any newly uncovered branch drops the figure below the floor and fails.
#
# When GITHUB_STEP_SUMMARY is set (GitHub Actions), a markdown report is
# appended to it. Needs only bash, awk and forge.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

MIN_LINES="${COVERAGE_MIN_LINES:-100}"
MIN_FUNCTIONS="${COVERAGE_MIN_FUNCTIONS:-100}"
MIN_BRANCHES="${COVERAGE_MIN_BRANCHES:-98.27}"
LCOV="lcov.info"

# Suites that must not run under coverage's instrumented, unoptimized build:
#   GasBenchmarks        gas figures from instrumented bytecode are meaningless
#   DeploymentIntegrity  compares against production bytecode, which this is not
#   Fork                 live-chain state would make coverage nondeterministic
EXCLUDED_SUITES='GasBenchmarks|DeploymentIntegrity|Fork'

case "${1:-}" in
  "") ;;
  --no-run) ;;
  -h | --help)
    sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  *)
    echo "usage: tools/coverage.sh [--no-run]" >&2
    exit 2
    ;;
esac

if [[ "${1:-}" != "--no-run" ]]; then
  rm -f "$LCOV"
  forge coverage \
    --report lcov \
    --report summary \
    --no-match-contract "$EXCLUDED_SUITES" \
    --no-match-coverage '^(test|script|lib)/'
fi

if [[ ! -s "$LCOV" ]]; then
  echo "error: $LCOV not found or empty; run tools/coverage.sh without --no-run" >&2
  exit 2
fi

# One pass over lcov.info. Emits tab-separated records:
#   F  file  linesHit linesFound  fnHit fnFound  brHit brFound
#   T  total ...same fields...
#   UL file line      (an uncovered line)
#   UB file line      (a branch never taken)
report="$(
  awk -v root="$PWD/" '
    BEGIN { OFS = "\t" }
    /^SF:/ {
      file = substr($0, 4)
      if (index(file, root) == 1) file = substr(file, length(root) + 1)
      insrc = (file ~ /^src\//)
      if (insrc) { order[++n] = file; lf[file] = lh[file] = ff[file] = fh[file] = bf[file] = bh[file] = 0 }
      next
    }
    !insrc { next }
    /^LF:/  { lf[file] = substr($0, 4) + 0; next }
    /^LH:/  { lh[file] = substr($0, 4) + 0; next }
    /^FNF:/ { ff[file] = substr($0, 5) + 0; next }
    /^FNH:/ { fh[file] = substr($0, 5) + 0; next }
    /^BRF:/ { bf[file] = substr($0, 5) + 0; next }
    /^BRH:/ { bh[file] = substr($0, 5) + 0; next }
    /^DA:/ {
      split(substr($0, 4), a, ",")
      if (a[2] + 0 == 0) print "UL", file, a[1]
      next
    }
    /^BRDA:/ {
      split(substr($0, 6), b, ",")
      if (b[4] == "-" || b[4] + 0 == 0) print "UB", file, b[1]
      next
    }
    END {
      for (i = 1; i <= n; i++) {
        f = order[i]
        print "F", f, lh[f], lf[f], fh[f], ff[f], bh[f], bf[f]
        tlh += lh[f]; tlf += lf[f]; tfh += fh[f]; tff += ff[f]; tbh += bh[f]; tbf += bf[f]
      }
      print "T", "Total", tlh + 0, tlf + 0, tfh + 0, tff + 0, tbh + 0, tbf + 0
    }
  ' "$LCOV"
)"

if ! grep -q '^F' <<<"$report"; then
  echo "error: $LCOV has no records for src/; did forge coverage run?" >&2
  exit 2
fi

# pct HIT FOUND -> "98.27" for 57/58: truncated, never rounded up, so a figure
# shown as meeting a floor really does (an empty metric counts as 100)
pct() { awk -v h="$1" -v f="$2" 'BEGIN { printf "%.2f", (f == 0 ? 100 : int(10000 * h / f) / 100) }'; }
# meets HIT FOUND MIN -> exit 0 iff HIT/FOUND >= MIN%, compared exactly
meets() { awk -v h="$1" -v f="$2" -v m="$3" 'BEGIN { exit !(f == 0 || h * 100 >= m * f - 1e-9) }'; }
cell() { printf '%s%% (%s/%s)' "$(pct "$1" "$2")" "$1" "$2"; }

read -r _ _ tlh tlf tfh tff tbh tbf < <(grep $'^T\t' <<<"$report" | tr '\t' ' ')

status=0
failures=()
meets "$tlh" "$tlf" "$MIN_LINES" || { status=1; failures+=("lines $(cell "$tlh" "$tlf") below the ${MIN_LINES}% floor"); }
meets "$tfh" "$tff" "$MIN_FUNCTIONS" || { status=1; failures+=("functions $(cell "$tfh" "$tff") below the ${MIN_FUNCTIONS}% floor"); }
meets "$tbh" "$tbf" "$MIN_BRANCHES" || { status=1; failures+=("branches $(cell "$tbh" "$tbf") below the ${MIN_BRANCHES}% floor"); }

# ---- Terminal report -------------------------------------------------------
echo
echo "Coverage of src/ (thresholds: lines >= ${MIN_LINES}%, functions >= ${MIN_FUNCTIONS}%, branches >= ${MIN_BRANCHES}%)"
echo
width=$(awk -F'\t' '$1 == "F" && length($2) > w { w = length($2) } END { print (w > 5 ? w : 5) }' <<<"$report")
row() { printf "  %-${width}s  %-20s  %-20s  %s\n" "$@"; }
row "File" "Lines" "Functions" "Branches"
while IFS=$'\t' read -r kind file l1 l2 f1 f2 b1 b2; do
  [[ "$kind" == F || "$kind" == T ]] || continue
  row "$file" "$(cell "$l1" "$l2")" "$(cell "$f1" "$f2")" "$(cell "$b1" "$b2")"
done <<<"$report"

uncovered="$(
  while IFS=$'\t' read -r kind file line _; do
    [[ "$kind" == UL || "$kind" == UB ]] || continue
    what=$([[ "$kind" == UL ]] && echo "line  " || echo "branch")
    src="$(sed -n "${line}p" "$file" 2>/dev/null | sed 's/^[[:space:]]*//')"
    printf '  %s %s:%s  %s\n' "$what" "$file" "$line" "$src"
  done <<<"$report"
)"
if [[ -n "$uncovered" ]]; then
  echo
  echo "Not covered:"
  echo "$uncovered"
fi
echo
if ((status == 0)); then
  echo "PASS: coverage thresholds met"
else
  for f in "${failures[@]}"; do echo "FAIL: $f" >&2; done
fi

# ---- GitHub Actions job summary --------------------------------------------
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "### Contract coverage (src/)"
    echo
    echo "| File | Lines | Functions | Branches |"
    echo "| --- | ---: | ---: | ---: |"
    while IFS=$'\t' read -r kind file l1 l2 f1 f2 b1 b2; do
      [[ "$kind" == F || "$kind" == T ]] || continue
      name=$([[ "$kind" == T ]] && echo "**Total**" || echo "\`$file\`")
      echo "| $name | $(cell "$l1" "$l2") | $(cell "$f1" "$f2") | $(cell "$b1" "$b2") |"
    done <<<"$report"
    echo
    if ((status == 0)); then
      echo "**Passed**: lines >= ${MIN_LINES}%, functions >= ${MIN_FUNCTIONS}%, branches >= ${MIN_BRANCHES}%."
    else
      joined="$(printf '%s; ' "${failures[@]}")"
      echo "**Failed**: ${joined%; }."
    fi
    if [[ -n "$uncovered" ]]; then
      echo
      echo "<details><summary>Not covered</summary>"
      echo
      echo '```'
      echo "$uncovered"
      echo '```'
      echo
      echo "</details>"
    fi
    echo
  } >>"$GITHUB_STEP_SUMMARY"
fi

exit "$status"
