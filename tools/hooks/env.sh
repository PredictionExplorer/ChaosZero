# shellcheck shell=sh
# Sourced (POSIX sh) by every git hook lefthook installs, before lefthook
# runs: see `rc:` in lefthook.yml.
#
# GUI git clients such as Sourcetree and Tower start hooks with the login
# PATH (/usr/bin:/bin:/usr/sbin:/sbin), without the shell profile that puts
# Node, pnpm, Foundry and the optional scanners on PATH, so the hooks would
# fail with "node: not found". This appends the usual install locations that
# exist, after everything already on PATH, so a working setup always wins.
# Anything more exotic goes in a personal lefthook-local.yml `rc:` file.

_chaoszero_path_append() {
  case ":$PATH:" in
    *":$1:"*) ;;
    *) if [ -d "$1" ]; then PATH="$PATH:$1"; fi ;;
  esac
}

if ! command -v node >/dev/null 2>&1; then
  # nvm: Node 22, the version .nvmrc pins (the last match of the glob).
  for _chaoszero_dir in "$HOME"/.nvm/versions/node/v22.*/bin; do
    if [ -d "$_chaoszero_dir" ]; then _chaoszero_nvm=$_chaoszero_dir; fi
  done
  if [ -n "${_chaoszero_nvm:-}" ]; then _chaoszero_path_append "$_chaoszero_nvm"; fi
  for _chaoszero_dir in \
    "$HOME/.volta/bin" \
    "$HOME/Library/Application Support/fnm/aliases/default/bin" \
    "$HOME/.local/share/fnm/aliases/default/bin" \
    /opt/homebrew/bin \
    /usr/local/bin; do
    _chaoszero_path_append "$_chaoszero_dir"
  done
fi

# pnpm installed standalone, Foundry (foundryup, make foundry), and the
# optional scanners (tools/setup.sh extras).
for _chaoszero_dir in \
  "${PNPM_HOME:-$HOME/Library/pnpm}" \
  "$HOME/.local/share/pnpm" \
  "$HOME/.foundry/bin" \
  "$HOME/.local/bin"; do
  _chaoszero_path_append "$_chaoszero_dir"
done

export PATH
unset _chaoszero_dir _chaoszero_nvm
unset -f _chaoszero_path_append
