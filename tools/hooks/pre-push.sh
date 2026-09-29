#!/usr/bin/env bash
# The pre-push hook's two halves (lefthook.yml runs them for each area):
#
#   tools/hooks/pre-push.sh --changed
#       Print the files the pushed commits change: the difference between
#       HEAD and the first of these that resolves: the branch's push target
#       (@{push}), its upstream, origin's default branch (origin/HEAD) and
#       origin/main. With none of them (no remote-tracking refs at all),
#       print every tracked file, so a check is never skipped for lack of a
#       base.
#   tools/hooks/pre-push.sh contracts|frontend FILE...
#       Run that area's checks when any FILE belongs to it.
#
# lefthook's own push-file lookup falls back to a local branch named after
# origin's default branch and fails the push when there is none (a
# `git clone --branch` checkout, or a deleted local main); a job's `files:`
# command replaces that lookup only when its `run` uses {files}, hence this
# split.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

if [[ ${1:-} == --changed ]]; then
  for ref in '@{push}' '@{upstream}' origin/HEAD origin/main; do
    if base=$(git merge-base HEAD "$ref" 2>/dev/null); then
      exec git diff --name-only "$base" HEAD --
    fi
  done
  echo "pre-push: no remote-tracking branch to compare with; checking everything" >&2
  exec git ls-files
fi

area=${1:-}
shift || true

case $area in
  contracts)
    # The deployment integrity test also reads the broadcast record and
    # frontend/.env.production; the Makefile and the tool pins drive the
    # checks themselves.
    include='(\.sol$|^foundry\.(toml|lock)$|^remappings\.txt$|^lib/|^snapshots/|^broadcast/|^frontend/src/test/fixtures/contract-vectors\.json$|^frontend/\.env\.production$|^Makefile$|^tools/versions\.env$)'
    exclude='^$'
    targets=(lint-contracts build gas-check test-contracts vectors-check)
    ;;
  frontend)
    include='^(frontend/|Makefile$|tools/versions\.env$)'
    exclude='^frontend/.*\.md$'
    targets=(lint-frontend typecheck test-frontend)
    ;;
  *)
    echo "usage: $0 --changed | $0 contracts|frontend FILE..." >&2
    exit 2
    ;;
esac

# No `grep -q` here: under pipefail, its early exit could fail the first grep
# with SIGPIPE and turn a match into a skip.
relevant=$(printf '%s\n' "$@" | grep -E "$include" | grep -Ev "$exclude" || true)
if [[ -z $relevant ]]; then
  echo "pre-push: the pushed commits do not touch $area; skipped"
  exit 0
fi

exec make "${targets[@]}"
