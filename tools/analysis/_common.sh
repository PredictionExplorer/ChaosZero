# shellcheck shell=bash
# Shared helpers for tools/analysis/*.sh. Source this file; do not execute it.

set -euo pipefail

ANALYSIS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# Every report, log and scratch build lands under here (gitignored).
ANALYSIS_OUT="${ANALYSIS_OUT:-$ANALYSIS_ROOT/.analysis}"

log() { printf '==> %s\n' "$*" >&2; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die() {
  printf 'error: %s\n' "$*" >&2
  exit 2
}

# require CMD HINT: fail early, with an install hint, when CMD is missing.
require() {
  command -v "$1" >/dev/null 2>&1 || die "$1 not found on PATH. $2"
}

# pinned_version KEY DEFAULT: the value of KEY in tools/versions.env, or
# DEFAULT when the file or the key is absent. A leading "v" is stripped so
# FOUNDRY_VERSION=v1.8.3 compares equal to `forge --version`'s 1.8.3.
pinned_version() {
  local key=$1 default=$2 file="$ANALYSIS_ROOT/tools/versions.env" value=""
  if [[ -f $file ]]; then
    value=$(sed -n "s/^${key}=//p" "$file" | tail -n 1 | tr -d "\"' \r")
  fi
  value=${value:-$default}
  printf '%s\n' "${value#v}"
}

# check_version NAME INSTALLED PINNED: results are only comparable with CI's
# when the tool versions match (Slither's finding ids, for one, embed its
# own description format). Fatal in CI, a warning locally.
check_version() {
  local name=$1 installed=$2 pinned=$3
  [[ $installed == "$pinned" ]] && return 0
  if [[ ${CI:-} == "true" ]]; then
    die "$name $installed is installed but tools/versions.env pins $pinned"
  fi
  warn "$name $installed is installed but tools/versions.env pins $pinned; results may differ from CI"
}

forge_version() { forge --version | sed -n 's/^forge Version: \([0-9.]*\).*/\1/p' | head -n 1; }

# step_summary: append stdin to the GitHub Actions job summary when running
# in Actions; discard it otherwise.
step_summary() {
  if [[ -n ${GITHUB_STEP_SUMMARY:-} ]]; then
    cat >>"$GITHUB_STEP_SUMMARY"
  else
    cat >/dev/null
  fi
}
