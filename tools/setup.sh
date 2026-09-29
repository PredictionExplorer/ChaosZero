#!/usr/bin/env bash
# Prepare a ChaosZero development environment. Idempotent: rerun it anytime.
#
#   tools/setup.sh           set up this clone: submodules, frontend
#                            dependencies, git hooks; then run the doctor
#   tools/setup.sh doctor    compare installed tools with tools/versions.env;
#                            exits 1 only when a required tool is missing
#   tools/setup.sh foundry   install the pinned Foundry release into
#                            ~/.foundry/bin and, on Linux, the pinned solc into
#                            the svm cache; both from GitHub releases and
#                            verified against the SHA-256 sums in versions.env
#   tools/setup.sh extras    install the pinned optional scanners: gitleaks and
#                            actionlint into ~/.local/bin (checked against the
#                            release checksums), typos, zizmor, slither and
#                            halmos with uv or pipx
#
# Runs on bash 3.2 (macOS) and Linux. Never uses sudo.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"
# shellcheck source=/dev/null # plain KEY=value pins, see tools/versions.env
. tools/versions.env

foundry_bin=${FOUNDRY_DIR:-$HOME/.foundry}/bin
local_bin=${XDG_BIN_HOME:-$HOME/.local/bin}

say() { printf '%s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}
have() { command -v "$1" >/dev/null 2>&1; }
upper() { printf '%s' "$1" | tr '[:lower:]' '[:upper:]'; }

# First x.y.z in a command's output: "forge Version: 1.8.3-stable" -> 1.8.3.
version_of() {
  { "$@" 2>/dev/null || true; } | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1 || true
}

sha256_of() {
  if have sha256sum; then
    sha256sum "$1" | cut -d ' ' -f 1
  else
    shasum -a 256 "$1" | cut -d ' ' -f 1
  fi
}

# download <url> <file>
download() {
  curl --proto '=https' --tlsv1.2 -fsSL --retry 3 --retry-delay 2 -o "$2" "$1"
}

# verify <file> <expected sha256> <label>
verify() {
  local actual
  actual=$(sha256_of "$1")
  [ "$actual" = "$2" ] || die "checksum mismatch for $3: expected $2, got $actual"
}

tmp_dirs=()
cleanup() {
  local dir
  for dir in ${tmp_dirs[@]+"${tmp_dirs[@]}"}; do rm -rf "$dir"; done
}
trap cleanup EXIT
# Sets tmp to a fresh directory that is removed on exit.
make_tmp() {
  tmp=$(mktemp -d "${TMPDIR:-/tmp}/chaoszero-setup.XXXXXX")
  tmp_dirs+=("$tmp")
}

# Sets os (linux|darwin) and arch (amd64|arm64).
detect_platform() {
  case $(uname -s) in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    *) die "unsupported OS $(uname -s): install the tools listed in tools/versions.env by hand" ;;
  esac
  case $(uname -m) in
    x86_64 | amd64) arch=amd64 ;;
    arm64 | aarch64) arch=arm64 ;;
    *) die "unsupported CPU $(uname -m): install the tools listed in tools/versions.env by hand" ;;
  esac
}

# Where forge (svm-rs) caches compilers: ~/.svm when it exists, else the XDG
# data dir (Linux) or Application Support (macOS).
svm_dir() {
  local candidate
  for candidate in "$HOME/.svm" "${XDG_DATA_HOME:-$HOME/.local/share}/svm" \
    "$HOME/Library/Application Support/svm"; do
    if [ -d "$candidate" ]; then
      printf '%s' "$candidate"
      return
    fi
  done
  printf '%s' "$HOME/.svm"
}

warn_if_not_on_path() {
  case ":$PATH:" in
    *":$1:"*) ;;
    *) warn "$1 is not on PATH; add it in your shell profile" ;;
  esac
}

# ---------------------------------------------------------------- foundry

install_foundry() {
  detect_platform
  local want=${FOUNDRY_VERSION#v} found="" sum_var sum url tool
  if [ -x "$foundry_bin/forge" ]; then
    found=$(version_of "$foundry_bin/forge" --version)
  fi
  if [ "$found" = "$want" ]; then
    say "Foundry $FOUNDRY_VERSION already installed in $foundry_bin"
  else
    sum_var=FOUNDRY_SHA256_$(upper "$os")_$(upper "$arch")
    sum=${!sum_var:-}
    [ -n "$sum" ] || die "tools/versions.env has no $sum_var"
    url="https://github.com/foundry-rs/foundry/releases/download/$FOUNDRY_VERSION/foundry_${FOUNDRY_VERSION}_${os}_${arch}.tar.gz"
    make_tmp
    say "Downloading Foundry $FOUNDRY_VERSION ($os/$arch)"
    download "$url" "$tmp/foundry.tar.gz"
    verify "$tmp/foundry.tar.gz" "$sum" "Foundry $FOUNDRY_VERSION"
    mkdir -p "$tmp/x" "$foundry_bin"
    tar --no-same-owner -xzf "$tmp/foundry.tar.gz" -C "$tmp/x"
    for tool in forge cast anvil chisel; do
      [ -f "$tmp/x/$tool" ] || die "the Foundry archive has no $tool"
      chmod 0755 "$tmp/x/$tool"
      mv -f "$tmp/x/$tool" "$foundry_bin/$tool"
    done
    say "Installed forge, cast, anvil and chisel $FOUNDRY_VERSION into $foundry_bin"
  fi
  warn_if_not_on_path "$foundry_bin"
  if have forge && [ "$(command -v forge)" != "$foundry_bin/forge" ]; then
    warn "$(command -v forge) comes first on PATH and shadows $foundry_bin/forge"
  fi
  install_solc
}

# forge normally downloads solc from binaries.soliditylang.org on the first
# build; installing the checksummed GitHub release asset up front also works
# where that host is unreachable. svm-rs finds it at <svm>/<ver>/solc-<ver>.
install_solc() {
  detect_platform
  if [ "$os" != linux ]; then
    say "solc $SOLC_VERSION: forge downloads it on the first build"
    return
  fi
  local sum_var sum asset dest
  sum_var=SOLC_SHA256_LINUX_$(upper "$arch")
  sum=${!sum_var:-}
  [ -n "$sum" ] || die "tools/versions.env has no $sum_var"
  case $arch in
    amd64) asset=solc-static-linux ;;
    arm64) asset=solc-static-linux-arm ;;
  esac
  dest="$(svm_dir)/$SOLC_VERSION/solc-$SOLC_VERSION"
  if [ -x "$dest" ] && [ "$(sha256_of "$dest")" = "$sum" ]; then
    say "solc $SOLC_VERSION already installed at $dest"
    return
  fi
  make_tmp
  say "Downloading solc $SOLC_VERSION ($asset)"
  download "https://github.com/ethereum/solidity/releases/download/v$SOLC_VERSION/$asset" "$tmp/$asset"
  verify "$tmp/$asset" "$sum" "solc $SOLC_VERSION"
  chmod 0755 "$tmp/$asset"
  mkdir -p "$(dirname "$dest")"
  mv -f "$tmp/$asset" "$dest"
  say "Installed solc $SOLC_VERSION at $dest"
}

# ----------------------------------------------------------------- extras

# install_release_binary <tool> <version> <archive url> <checksums url>
install_release_binary() {
  local tool=$1 version=$2 url=$3 sums_url=$4 archive sum
  if [ "$(version_of "$local_bin/$tool" --version)" = "$version" ] ||
    { have "$tool" && [ "$(version_of "$tool" --version)" = "$version" ]; }; then
    say "$tool $version already installed"
    return
  fi
  make_tmp
  archive=${url##*/}
  say "Downloading $tool $version"
  download "$url" "$tmp/$archive"
  download "$sums_url" "$tmp/checksums.txt"
  sum=$(awk -v f="$archive" '$2 == f { print $1 }' "$tmp/checksums.txt")
  [ -n "$sum" ] || die "$archive is not listed in ${sums_url##*/}"
  verify "$tmp/$archive" "$sum" "$tool $version"
  tar --no-same-owner -xzf "$tmp/$archive" -C "$tmp" "$tool"
  mkdir -p "$local_bin"
  chmod 0755 "$tmp/$tool"
  mv -f "$tmp/$tool" "$local_bin/$tool"
  say "Installed $tool $version into $local_bin"
}

# install_python_tool <command> <PyPI package> <version>
install_python_tool() {
  local tool=$1 package=$2 version=$3
  if have "$tool" && [ "$(version_of "$tool" --version)" = "$version" ]; then
    say "$tool $version already installed"
    return
  fi
  if have uv; then
    uv tool install --force "$package==$version"
  elif have pipx; then
    pipx install --force "$package==$version"
  else
    warn "$tool: install uv (https://docs.astral.sh/uv) or pipx and rerun, or pip install $package==$version"
  fi
}

install_extras() {
  detect_platform
  local gitleaks_arch=x64
  [ "$arch" = amd64 ] || gitleaks_arch=arm64
  install_release_binary gitleaks "$GITLEAKS_VERSION" \
    "https://github.com/gitleaks/gitleaks/releases/download/v$GITLEAKS_VERSION/gitleaks_${GITLEAKS_VERSION}_${os}_${gitleaks_arch}.tar.gz" \
    "https://github.com/gitleaks/gitleaks/releases/download/v$GITLEAKS_VERSION/gitleaks_${GITLEAKS_VERSION}_checksums.txt"
  install_release_binary actionlint "$ACTIONLINT_VERSION" \
    "https://github.com/rhysd/actionlint/releases/download/v$ACTIONLINT_VERSION/actionlint_${ACTIONLINT_VERSION}_${os}_${arch}.tar.gz" \
    "https://github.com/rhysd/actionlint/releases/download/v$ACTIONLINT_VERSION/actionlint_${ACTIONLINT_VERSION}_checksums.txt"
  install_python_tool typos typos "$TYPOS_VERSION"
  install_python_tool zizmor zizmor "$ZIZMOR_VERSION"
  install_python_tool slither slither-analyzer "$SLITHER_VERSION"
  install_python_tool halmos halmos "$HALMOS_VERSION"
  warn_if_not_on_path "$local_bin"
}

# ----------------------------------------------------------------- doctor

missing_required=0
warnings=0
missing_optional=0
hooks_missing=0

# row <status> <tool> <found> <note> [hint]
row() {
  printf '  %-7s %-11s %-12s %s\n' "[$1]" "$2" "${3:--}" "$4${5:+  ($5)}"
}

# check <required|optional> <tool> <pinned version> <found version> <hint>
# A pinned bare major ("22") matches any release of that major.
check() {
  local kind=$1 tool=$2 want=$3 found=$4 hint=$5
  if [ -z "$found" ]; then
    if [ "$kind" = required ]; then
      missing_required=$((missing_required + 1))
      row fail "$tool" "" "pinned $want" "$hint"
    else
      missing_optional=$((missing_optional + 1))
      row skip "$tool" "" "pinned $want" "$hint"
    fi
  elif [ "$found" = "$want" ] || [ "${found%%.*}" = "$want" ]; then
    row ok "$tool" "$found" "pinned $want"
  else
    warnings=$((warnings + 1))
    row warn "$tool" "$found" "pinned $want" "$hint"
  fi
}

cmd_doctor() {
  local node_want pnpm_want git_found solc_path lefthook_bin=frontend/node_modules/.bin/lefthook
  node_want=$(tr -d '[:space:]v' <.nvmrc)
  pnpm_want=$(sed -n 's/.*"packageManager": *"pnpm@\([0-9.]*\).*/\1/p' frontend/package.json)

  say "ChaosZero toolchain (pins: tools/versions.env, .nvmrc, frontend/package.json)"
  say ""
  say "Required"
  git_found=$(version_of git --version)
  if [ -n "$git_found" ]; then
    row ok git "$git_found" "any recent version"
  else
    missing_required=$((missing_required + 1))
    row fail git "" "not installed"
  fi
  if ! have forge && [ -x "$foundry_bin/forge" ]; then
    # make adds this directory to PATH itself; a shell needs it in its profile.
    warnings=$((warnings + 1))
    row warn forge "$(version_of "$foundry_bin/forge" --version)" "not on PATH" \
      "add $foundry_bin to PATH"
  else
    check required forge "${FOUNDRY_VERSION#v}" "$(version_of forge --version)" \
      "make foundry, or foundryup --install $FOUNDRY_VERSION"
  fi
  solc_path="$(svm_dir)/$SOLC_VERSION/solc-$SOLC_VERSION"
  if [ -x "$solc_path" ]; then
    row ok solc "$SOLC_VERSION" "cached at $solc_path"
  else
    row info solc "" "pinned $SOLC_VERSION" "forge downloads it on the first build"
  fi
  check required node "$node_want" "$(version_of node --version)" "nvm install, which reads .nvmrc"
  check required pnpm "$pnpm_want" "$(version_of pnpm --version)" "corepack enable pnpm"
  check required lefthook "$LEFTHOOK_VERSION" "$(version_of "$lefthook_bin" version)" \
    "make setup installs it with the frontend dependencies"
  if [ -x "$lefthook_bin" ]; then
    if (cd frontend && node_modules/.bin/lefthook check-install >/dev/null 2>&1); then
      row ok hooks "" "installed from lefthook.yml"
    else
      hooks_missing=1
      row warn hooks "" "not installed or stale" "make hooks"
    fi
  fi

  say ""
  say "Optional here, enforced by CI"
  check optional gitleaks "$GITLEAKS_VERSION" "$(version_of gitleaks version)" "make extras, or brew install gitleaks"
  check optional typos "$TYPOS_VERSION" "$(version_of typos --version)" "make extras, or brew install typos-cli"
  check optional actionlint "$ACTIONLINT_VERSION" "$(version_of actionlint --version)" "make extras, or brew install actionlint"
  check optional zizmor "$ZIZMOR_VERSION" "$(version_of zizmor --version)" "make extras, or brew install zizmor"
  check optional slither "$SLITHER_VERSION" "$(version_of slither --version)" "make extras, or pipx install slither-analyzer==$SLITHER_VERSION"
  check optional halmos "$HALMOS_VERSION" "$(version_of halmos --version)" "make extras, or pipx install halmos==$HALMOS_VERSION"

  say ""
  if [ "$missing_required" -gt 0 ]; then
    say "$missing_required required tool(s) missing."
  else
    say "All required tools present."
  fi
  if [ "$warnings" -gt 0 ]; then
    say "$warnings warning(s) above: tools off PATH or other than the pinned versions can disagree with CI (formatting, gas snapshots)."
  fi
  if [ "$hooks_missing" -eq 1 ]; then
    say "Git hooks are not installed (or lefthook.yml changed since): run make hooks."
  fi
  if [ "$missing_optional" -gt 0 ]; then
    say "$missing_optional optional tool(s) missing: their hooks skip locally and CI still runs them."
  fi
  [ "$missing_required" -eq 0 ]
}

# ------------------------------------------------------------------ setup

cmd_setup() {
  step "Git submodules"
  git submodule update --init --recursive

  step "Frontend dependencies"
  local node_want node_major
  node_want=$(tr -d '[:space:]v' <.nvmrc)
  have node || die "node is not installed: install Node $node_want (nvm install reads .nvmrc)"
  node_major=$(version_of node --version)
  node_major=${node_major%%.*}
  [ "$node_major" = "$node_want" ] || die "node $(node --version) found, Node $node_want expected (nvm use reads .nvmrc)"
  if ! have pnpm; then
    have corepack || die "pnpm is not installed: corepack enable pnpm, or npm install -g pnpm"
    say "Enabling pnpm through corepack"
    corepack enable pnpm || die "corepack could not enable pnpm; install it with npm install -g pnpm"
  fi
  # Its "prepare" script installs the git hooks too (skipped when CI is set).
  (cd frontend && pnpm install --frozen-lockfile)

  step "Git hooks"
  if (cd frontend && node_modules/.bin/lefthook check-install >/dev/null 2>&1); then
    say "Installed from lefthook.yml"
  else
    (cd frontend && node_modules/.bin/lefthook install)
  fi

  step "git blame"
  # Skip mechanical reformatting commits (listed in .git-blame-ignore-revs).
  # The setting lives in the shared .git/config, so it also applies to
  # checkouts of commits older than the file, where git blame then fails.
  # Git 2.52 added the :(optional) prefix, which makes a missing file a
  # no-op; older git reads that prefix as part of the file name, so there
  # the setting is left to the developer.
  local git_major git_minor
  IFS=. read -r git_major git_minor _ <<<"$(git --version | sed 's/^git version //')"
  if [ "${git_major:-0}" -gt 2 ] || { [ "${git_major:-0}" -eq 2 ] && [ "${git_minor:-0}" -ge 52 ]; }; then
    git config blame.ignoreRevsFile ':(optional).git-blame-ignore-revs'
    say "blame.ignoreRevsFile = :(optional).git-blame-ignore-revs"
  elif [ "$(git config blame.ignoreRevsFile || true)" = .git-blame-ignore-revs ]; then
    say "blame.ignoreRevsFile already set (git blame fails on commits older than the file; --no-ignore-revs-file bypasses it)"
  else
    say "Optional, with git older than 2.52: git config blame.ignoreRevsFile .git-blame-ignore-revs"
    say "(git blame then fails on commits older than that file; --no-ignore-revs-file bypasses it)"
  fi

  if ! have forge && [ ! -x "$foundry_bin/forge" ]; then
    warn "forge not found: run make foundry (pinned, checksum-verified) or foundryup --install $FOUNDRY_VERSION"
  fi

  step "Doctor"
  cmd_doctor || true
}

case ${1:-setup} in
  setup) cmd_setup ;;
  doctor) cmd_doctor ;;
  foundry) install_foundry ;;
  extras) install_extras ;;
  -h | --help | help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) die "unknown command '$1' (try: setup, doctor, foundry, extras)" ;;
esac
