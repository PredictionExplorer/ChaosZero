#!/usr/bin/env bash
# Pre-commit guard over exactly what is about to be committed (the index, not
# the working tree). It blocks:
#   1. merge-conflict markers on added lines
#   2. files larger than CHECK_STAGED_MAX_KB (default 1024 KB), except the
#      allowlist below; history keeps every blob forever, so big files belong
#      in releases or external storage
#   3. .env files, except the committed ones that hold only public values
#
# Runs on bash 3.2 (macOS) and BSD or GNU userlands. Bypass once, knowingly,
# with `git commit --no-verify`.
set -euo pipefail

max_kb=${CHECK_STAGED_MAX_KB:-1024}

# Committed on purpose and allowed past the size limit.
size_allowlist=(
  frontend/pnpm-lock.yaml
  frontend/src/test/fixtures/contract-vectors.json
)

# .env files that hold only public values and are committed on purpose.
env_allowlist=(
  frontend/.env.example
  frontend/.env.production
)

in_list() {
  local needle=$1 item
  shift
  for item in "$@"; do
    [ "$item" = "$needle" ] && return 0
  done
  return 1
}

problems=()
report() { problems+=("$1"); }

tmp=$(mktemp "${TMPDIR:-/tmp}/check-staged.XXXXXX")
trap 'rm -f "$tmp"' EXIT

# 1. Conflict markers on added lines. Only the unambiguous start and end
#    markers count: a bare "=======" is also a Markdown heading underline.
git -c core.quotePath=false diff --cached --diff-filter=ACMR --unified=0 \
  --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ >"$tmp"
while IFS= read -r hit; do
  report "conflict marker   $hit"
done < <(awk '
  /^diff --git / { in_hunk = 0; next }
  !in_hunk && /^\+\+\+ / {
    # "+++ b/<path>", with a trailing tab when the path has spaces and in
    # quotes when it has unusual characters
    file = substr($0, 5)
    sub(/\t$/, "", file)
    if (file ~ /^"/) file = substr(file, 2, length(file) - 2)
    sub(/^b\//, "", file)
    next
  }
  /^@@ / {
    in_hunk = 1
    split($3, range, ",")
    line = substr(range[1], 2) + 0
    next
  }
  in_hunk && /^\+/ {
    text = substr($0, 2)
    if (text ~ /^(<<<<<<<|>>>>>>>)( |$)/) print file ":" line ": " text
    line++
  }
' "$tmp")

# 2 and 3. Walk the staged entries (NUL-separated, so any file name works).
#    Raw records look like ":<old mode> <new mode> <old sha> <new sha> <status>"
#    followed by the path, or by two paths for renames and copies.
git diff --cached --raw -z --no-abbrev --diff-filter=ACMR >"$tmp"
while IFS= read -r -d '' meta && IFS= read -r -d '' path; do
  set -f
  # shellcheck disable=SC2086 # split the record into its fields
  set -- $meta
  set +f
  mode=$2 sha=$4 status=$5
  case $status in
    R* | C*) IFS= read -r -d '' path ;;
  esac
  [ "$mode" = 160000 ] && continue # submodule pointer, not a file

  size=$(git cat-file -s "$sha")
  if [ "$size" -gt $((max_kb * 1024)) ] && ! in_list "$path" "${size_allowlist[@]}"; then
    report "too large         $path ($((size / 1024)) KB, limit ${max_kb} KB)"
  fi

  case ${path##*/} in
    .env | .env.*)
      if ! in_list "$path" "${env_allowlist[@]}"; then
        report ".env file         $path (keep secrets out of git; frontend/.env.example documents the variables)"
      fi
      ;;
  esac
done <"$tmp"

if [ "${#problems[@]}" -gt 0 ]; then
  echo "The staged changes have ${#problems[@]} problem(s):" >&2
  for problem in "${problems[@]}"; do
    echo "  $problem" >&2
  done
  echo "Fix and re-stage, or bypass once with: git commit --no-verify" >&2
  exit 1
fi
