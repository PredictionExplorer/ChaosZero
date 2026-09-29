#!/usr/bin/env bash
# Mutation testing of the market contract with Foundry's native engine
# (`forge test --mutate`), meant for the weekly scheduled CI job.
#
#   tools/analysis/mutation.sh [extra `forge test` flags]
#
# Environment:
#   MUTATION_TARGET    file to mutate          (default src/GestureSeriesMarket.sol)
#   MUTATION_JOBS      parallel mutants        (default: CPU count)
#   MUTATION_TIMEOUT   seconds per mutant      (default 120, ~20x a normal mutant)
#   MUTATION_EXCLUDE   --no-match-contract regex for suites that cannot kill
#                      mutants meaningfully (default
#                      "Fork|GasBenchmarks|DeploymentIntegrity")
#   MUTATION_MAX_SURVIVING_EXPRESSIONS
#                      optional gate: fail when more distinct source expressions
#                      have a surviving mutant than this
#
# The campaign runs in a throwaway copy of the project under the fast
# `mutation` profile (foundry.toml), so neither the committed sources nor the
# developer's build are ever touched; the copy is removed on exit and src/ is
# verified unchanged. Foundry additionally tests each mutant in its own
# workspace, and --fail-fast ends a mutant's run at its first failing test.
# Reports land in .analysis/mutation/ (gitignored): results.json (Foundry's
# raw output), summary.md (also printed, and appended to the GitHub job
# summary), surviving-expressions.txt and forge.log. See
# tools/analysis/README.md for how to read them.

# shellcheck source=tools/analysis/_common.sh
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
cd "$ANALYSIS_ROOT" || exit 1

require forge "Install Foundry $(pinned_version FOUNDRY_VERSION 1.8.3) with foundryup."
require python3 "Python 3 renders the report."
check_version forge "$(forge_version)" "$(pinned_version FOUNDRY_VERSION 1.8.3)"

target=${MUTATION_TARGET:-src/GestureSeriesMarket.sol}
jobs=${MUTATION_JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 2)}
per_mutant_timeout=${MUTATION_TIMEOUT:-120}
exclude=${MUTATION_EXCLUDE:-Fork|GasBenchmarks|DeploymentIntegrity}
[[ -f $target ]] || die "mutation target $target does not exist"

out="$ANALYSIS_OUT/mutation"
rm -rf "$out"
mkdir -p "$out"

if command -v sha256sum >/dev/null 2>&1; then sha256=(sha256sum); else sha256=(shasum -a 256); fi
src_digest() { find src -type f -print0 | LC_ALL=C sort -z | xargs -0 "${sha256[@]}" | "${sha256[@]}"; }
digest_before=$(src_digest)

# base/project is the copy Foundry mutates; base/tmp receives Foundry's
# per-mutant workspaces, so an interrupted run leaves nothing behind.
base=$(mktemp -d "${TMPDIR:-/tmp}/mutation.XXXXXX")
workspace="$base/project"
mkdir -p "$workspace" "$base/tmp"
heartbeat_pid=""
forge_pid=""
cleanup() {
  local status=$?
  if [[ -n $heartbeat_pid ]]; then kill "$heartbeat_pid" 2>/dev/null || true; fi
  if [[ -n $forge_pid ]]; then
    kill "$forge_pid" 2>/dev/null || true
    wait "$forge_pid" 2>/dev/null || true
  fi
  rm -rf "$base"
  if [[ $(src_digest) != "$digest_before" ]]; then
    printf 'error: src/ changed during the mutation campaign; restore it with git checkout -- src\n' >&2
    status=3
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# The project as Foundry sees it, minus every build artifact. lib/ is copied
# rather than linked so nothing a test writes can reach the real checkout.
for path in foundry.toml foundry.lock remappings.txt src test script lib; do
  if [[ -e $path ]]; then cp -R "$path" "$workspace/"; fi
done

log "mutating $target: $jobs parallel jobs, ${per_mutant_timeout}s per mutant, excluding /$exclude/"
(
  while sleep 300; do log "mutation campaign still running ($((SECONDS / 60)) min elapsed)"; done
) &
heartbeat_pid=$!

# Run forge in the background and wait for it, so a TERM or INT delivered to
# this script alone (e.g. a cancelled CI job) is handled at once: the trap
# stops forge and removes the copy instead of waiting out the campaign.
(
  cd "$workspace"
  unset ARBITRUM_RPC_URL FORGE_SNAPSHOT_CHECK
  export TMPDIR="$base/tmp"
  exec env FOUNDRY_PROFILE=mutation forge test --mutate "$target" \
    --mutation-jobs "$jobs" --mutation-timeout "$per_mutant_timeout" \
    --no-match-contract "$exclude" --fail-fast --json "$@"
) >"$out/results.json" 2>"$out/forge.log" &
forge_pid=$!
status=0
wait "$forge_pid" || status=$?
forge_pid=""
kill "$heartbeat_pid" 2>/dev/null || true
heartbeat_pid=""

if [[ $status -ne 0 ]] || ! python3 -c 'import json,sys; json.load(open(sys.argv[1]))["summary"]' "$out/results.json" 2>/dev/null; then
  cat "$out/forge.log" >&2
  head -c 4000 "$out/results.json" >&2 || true
  die "forge mutation run failed (exit $status); see $out/forge.log"
fi

python3 - "$out/results.json" "$target" "$out/summary.md" "$out/surviving-expressions.txt" <<'PY'
import json
import sys
from pathlib import Path

results_path, target, summary_path, expressions_path = sys.argv[1:5]
data = json.loads(Path(results_path).read_text())
s = data["summary"]
survivors = [(path, m) for path, ms in data.get("survived_mutants", {}).items() for m in ms]
survivors.sort(key=lambda pm: (pm[0], pm[1]["line"], pm[1]["column"], pm[1]["mutant"]))

# Foundry stops testing an expression once one of its mutants survives, so
# how many mutants get tested (and so the score) depends on scheduling. The
# set of expressions with a survivor does not: that is the stable metric.
expressions = sorted({(p, m["line"], m["column"], m["original"]) for p, m in survivors})
Path(expressions_path).write_text("".join(f"{p}:{l}:{c}\t{o}\n" for p, l, c, o in expressions))

sources = {}

def source_line(path: str, line: int) -> str:
    if path not in sources:
        try:
            sources[path] = Path(path).read_text().splitlines()
        except OSError:
            sources[path] = []
    lines = sources[path]
    return lines[line - 1].strip() if 0 < line <= len(lines) else ""

score = s.get("mutation_score")
score_txt = f"{score:.1f}%" if isinstance(score, (int, float)) else "n/a"
tested = s["killed"] + s["survived"]
md = [
    f"### Mutation testing: `{target}`",
    "",
    f"**{len(expressions)} source expressions have a surviving mutant**; "
    f"{s['killed']} of {tested} tested mutants were killed (score {score_txt}).",
    "",
    "| Generated | Killed | Survived | Timed out | Invalid | Skipped | Duration |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    f"| {s['total']} | {s['killed']} | {s['survived']} | {s['timed_out']} | {s['invalid']} | {s['skipped']} "
    f"| {s.get('duration_secs', 0) / 60:.1f} min |",
    "",
    "Skipped mutants are redundant: Foundry stops mutating an expression once one of its mutants "
    "survives, so the score varies slightly with scheduling while the set of surviving expressions "
    "does not. Invalid mutants did not compile.",
    "",
]
if survivors:
    md += ["#### Surviving mutants", ""]
    limit = 250
    for path, m in survivors[:limit]:
        md += [
            f"`{path}:{m['line']}:{m['column']}` `{source_line(path, m['line'])}`",
            "```diff",
            f"- {m['original']}",
            f"+ {m['mutant']}",
            "```",
        ]
    if len(survivors) > limit:
        md.append(f"... and {len(survivors) - limit} more in `results.json`.")
Path(summary_path).write_text("\n".join(md) + "\n")
PY

cat "$out/summary.md"
step_summary <"$out/summary.md"

surviving=$(wc -l <"$out/surviving-expressions.txt" | tr -d ' ')
if [[ -n ${MUTATION_MAX_SURVIVING_EXPRESSIONS:-} && $surviving -gt $MUTATION_MAX_SURVIVING_EXPRESSIONS ]]; then
  die "$surviving surviving expressions exceed MUTATION_MAX_SURVIVING_EXPRESSIONS=$MUTATION_MAX_SURVIVING_EXPRESSIONS"
fi
log "mutation report: $out/summary.md"
