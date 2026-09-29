#!/bin/sh
# Run a hook command only when its tool is installed.
#
#   tools/hooks/optional.sh <tool> <command> [args...]
#
# Optional scanners (gitleaks, typos) give fast local feedback, but CI enforces
# them on every push and pull request, so a missing binary must not block a
# commit. Print one line saying so and succeed.
set -eu

if [ "$#" -lt 2 ]; then
  echo "usage: $0 <tool> <command> [args...]" >&2
  exit 2
fi

tool=$1
shift

if command -v "$tool" >/dev/null 2>&1; then
  exec "$@"
fi

case $tool in
  typos) brew_formula=typos-cli ;;
  *) brew_formula=$tool ;;
esac
echo "$tool not installed: skipped here, CI enforces it (install with tools/setup.sh extras or brew install $brew_formula)"
