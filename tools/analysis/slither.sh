#!/usr/bin/env bash
# Slither static analysis of src/, gated by the committed triage database.
#
#   tools/analysis/slither.sh [extra slither flags]
#
# Exits 0 when every finding is triaged in slither.db.json and non-zero on
# any other finding, at any severity (Slither's default "pedantic" fail
# level). Triage entries match single findings by id, so a NEW instance of
# an already-triaged detector class still fails. See tools/analysis/README.md.
#
# Writes .analysis/slither/slither.sarif (untriaged findings only, for GitHub
# code scanning) and .analysis/slither/slither.json.
#
# Equivalent to `slither . --config-file slither.config.json` except that the
# build Slither triggers (crytic-compile runs `forge clean` and then
# `forge build --force`) goes to a private directory instead of wiping the
# developer's out/ and cache/.

# shellcheck source=tools/analysis/_common.sh
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
cd "$ANALYSIS_ROOT" || exit 1

pinned=$(pinned_version SLITHER_VERSION 0.11.6)
require slither "Install it with: pipx install slither-analyzer==$pinned"
require forge "Install Foundry $(pinned_version FOUNDRY_VERSION 1.8.3) with foundryup."
check_version slither "$(slither --version)" "$pinned"

out="$ANALYSIS_OUT/slither"
mkdir -p "$out"
# Slither refuses to overwrite an existing report file.
rm -f "$out/slither.sarif" "$out/slither.json"
export FOUNDRY_OUT="$out/forge-out" FOUNDRY_CACHE_PATH="$out/forge-cache"

status=0
slither . --config-file slither.config.json \
  --sarif "$out/slither.sarif" --json "$out/slither.json" "$@" || status=$?

untriaged=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(len(d.get("results",{}).get("detectors",[])))' "$out/slither.json" 2>/dev/null || echo "?")
triaged=$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))))' slither.db.json)

if [[ $status -eq 0 ]]; then
  log "slither: clean ($triaged triaged findings in slither.db.json, 0 untriaged)"
  verdict=":white_check_mark: no untriaged findings"
else
  log "slither: $untriaged untriaged finding(s); triage them in slither.db.json (see tools/analysis/README.md)"
  verdict=":x: $untriaged untriaged finding(s): see the log above and the code-scanning alerts"
fi

step_summary <<EOF
### Slither $(slither --version)

$verdict. $triaged known false positives are documented in \`slither.db.json\` and \`tools/analysis/README.md\`.
EOF

exit "$status"
