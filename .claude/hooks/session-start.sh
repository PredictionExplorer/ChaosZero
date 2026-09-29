#!/usr/bin/env bash
# SessionStart hook for Claude Code on the web (registered in
# .claude/settings.json). Prepares a fresh cloud container for `make check`:
#
#   - Foundry and solc at the versions pinned in tools/versions.env, from
#     GitHub release assets verified by SHA-256 (foundry.paradigm.xyz and
#     binaries.soliditylang.org are not reachable from that sandbox), into
#     ~/.foundry/bin and ~/.svm/<version>/solc-<version>
#   - the forge-std submodule
#   - the frontend dependencies (pnpm install --frozen-lockfile)
#   - Foundry on PATH for the rest of the session, through CLAUDE_ENV_FILE
#
# Idempotent: a second run downloads nothing. Does nothing outside the web
# sandbox (CLAUDE_CODE_REMOTE=true), so local sessions are never touched.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# Hook stdout becomes session context: send the logs to stderr and print a
# one-line summary at the end.
exec 3>&1 1>&2

foundry_bin=${FOUNDRY_DIR:-$HOME/.foundry}/bin
local_bin=$HOME/.local/bin
export PATH="$foundry_bin:$local_bin:$PATH"

tools/setup.sh foundry

git submodule update --init --recursive

if ! command -v pnpm >/dev/null 2>&1; then
  mkdir -p "$local_bin"
  corepack enable --install-directory "$local_bin" pnpm
fi
(cd frontend && pnpm install --frozen-lockfile)

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  path_line="export PATH=\"$foundry_bin:$local_bin:\$PATH\""
  if ! grep -qxF "$path_line" "$CLAUDE_ENV_FILE" 2>/dev/null; then
    printf '%s\n' "$path_line" >>"$CLAUDE_ENV_FILE"
  fi
fi

forge_version=$(forge --version | sed -n 1p)
echo "ChaosZero toolchain ready (${forge_version}, pinned solc, frontend dependencies). Run make help for tasks; make check runs every offline CI gate." >&3
