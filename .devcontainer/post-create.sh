#!/usr/bin/env bash
# Runs once when the dev container is created (postCreateCommand). Installs the
# pinned toolchain with the same script contributors use on their machines.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
export PATH="$HOME/.foundry/bin:$HOME/.local/bin:$PATH"

# The workspace is bind-mounted with the host's owner; let git trust it.
git config --global --add safe.directory "$PWD"

# pnpm at exactly the version in frontend/package.json ("packageManager"),
# through corepack shims in ~/.local/bin (on PATH, and no root needed).
mkdir -p "$HOME/.local/bin"
corepack enable --install-directory "$HOME/.local/bin" pnpm

# Foundry and solc, pinned and checksum-verified (tools/versions.env).
tools/setup.sh foundry

# Optional scanners the git hooks and CI use: gitleaks, typos, actionlint,
# zizmor, slither, halmos. Opt out with CHAOSZERO_INSTALL_EXTRAS=false.
if [ "${CHAOSZERO_INSTALL_EXTRAS:-true}" = true ]; then
  tools/setup.sh extras || echo "warning: some optional scanners did not install; retry with: make extras" >&2
fi

# Submodules, frontend dependencies, git hooks, and a doctor report.
tools/setup.sh
