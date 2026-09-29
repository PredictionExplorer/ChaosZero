#!/usr/bin/env bash
#
# End-to-end tests: the production build of the frontend, in a real browser,
# against the real GestureSeriesMarket bytecode on a throwaway anvil chain.
#
#   tools/e2e.sh                                # everything, all Playwright projects
#   tools/e2e.sh --project=chromium --grep @chain
#   E2E_SKIP_BUILD=1 tools/e2e.sh               # reuse the last e2e build (iterating on specs)
#
# Steps: start anvil -> deploy script/DeployLocal.s.sol (mock game + mock CST
# + the market, pool seeded) -> read the addresses from forge's broadcast
# record -> `next build` against that deployment -> `next start` -> Playwright.
# anvil and next are always stopped on exit, whatever happens. Arguments are
# passed through to `playwright test`. Logs land in .logs/e2e/.
#
# Environment:
#   E2E_WEB_PORT                          port for `next start` (default 3100)
#   E2E_SKIP_BUILD=1                      skip `next build` if .next already holds an e2e
#                                         build of this exact deployment
#   PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH   use a local Chromium instead of Playwright's
#   CI                                    set by CI providers: retries, forbid .only,
#                                         GitHub annotations (see frontend/playwright.config.ts)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND="$ROOT/frontend"
LOG_DIR="$ROOT/.logs/e2e"

# anvil's default port, and deliberately not configurable: on chain 31337 the
# app's Mock Connector sends wallet requests to the chain's default RPC URL
# (http://127.0.0.1:8545), whatever NEXT_PUBLIC_RPC_URL says.
ANVIL_PORT=8545
RPC_URL="http://127.0.0.1:${ANVIL_PORT}"
WEB_PORT="${E2E_WEB_PORT:-3100}"
WEB_URL="http://127.0.0.1:${WEB_PORT}"
# anvil's well-known dev account #0 (public test mnemonic; never holds real value).
ANVIL_DEV_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
BROADCAST="$ROOT/broadcast/DeployLocal.s.sol/31337/run-latest.json"
BUILD_STAMP="$FRONTEND/.next/e2e-build.env"

if [[ -z "${NO_COLOR:-}" && (-t 1 || -n "${CI:-}") ]]; then
  CYAN=$'\033[1;36m' RED=$'\033[1;31m' RESET=$'\033[0m'
else
  CYAN="" RED="" RESET=""
fi
log() { printf '%s[e2e]%s %s\n' "$CYAN" "$RESET" "$*"; }
die() { printf '%s[e2e] error:%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

ANVIL_PID=""
NEXT_PID=""
PLAYWRIGHT_PID=""

# shellcheck disable=SC2329 # invoked by cleanup
stop() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null || return 0
  kill -TERM "$pid" 2>/dev/null || true
  # Give it a moment to shut down cleanly, then insist.
  for _ in {1..50}; do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
  kill -KILL "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
}

# shellcheck disable=SC2329 # invoked by the EXIT trap
cleanup() {
  local status=$?
  trap - EXIT INT TERM
  stop "$PLAYWRIGHT_PID"
  stop "$NEXT_PID"
  stop "$ANVIL_PID"
  if [[ $status -ne 0 ]]; then
    log "failed (exit $status); server logs are in ${LOG_DIR#"$ROOT"/}/, the Playwright report in frontend/playwright-report/"
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

port_in_use() { (: <"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

# Polls until "$@" succeeds; fails if the process $1 dies or $2 seconds pass.
wait_until() {
  local pid="$1" timeout_s="$2" what="$3"
  shift 3
  local deadline=$((SECONDS + timeout_s))
  until "$@" >/dev/null 2>&1; do
    kill -0 "$pid" 2>/dev/null || die "$what exited during startup"
    ((SECONDS < deadline)) || die "$what not ready after ${timeout_s}s"
    sleep 0.2
  done
}

# shellcheck disable=SC2329 # invoked through wait_until
rpc_ready() {
  curl -sf -X POST -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "$RPC_URL"
}

# --------------------------------------------------------------- preflight
for tool in anvil forge node pnpm curl; do
  command -v "$tool" >/dev/null || die "'$tool' not found on PATH (Foundry: https://getfoundry.sh, then 'pnpm install' in frontend/)"
done
[[ -x "$FRONTEND/node_modules/.bin/playwright" ]] || die "frontend dependencies missing: run 'pnpm install' in frontend/"
port_in_use "$ANVIL_PORT" && die "port $ANVIL_PORT is busy (another anvil?); the e2e chain needs it"
port_in_use "$WEB_PORT" && die "port $WEB_PORT is busy; free it or set E2E_WEB_PORT"
mkdir -p "$LOG_DIR"

# ------------------------------------------------------------------ chain
log "starting anvil on $RPC_URL"
anvil --host 127.0.0.1 --port "$ANVIL_PORT" --chain-id 31337 --quiet >"$LOG_DIR/anvil.log" 2>&1 &
ANVIL_PID=$!
wait_until "$ANVIL_PID" 30 anvil rpc_ready

log "deploying script/DeployLocal.s.sol (compiles the contracts first when the forge cache is cold)"
rm -f "$BROADCAST"
# --slow sends each transaction only after the previous one is mined, so every
# transaction gets its own block and the deploy block is the same on every
# run (sent all at once, anvil packs a timing-dependent number into block 1).
# --disable-external-identification: a local mock deployment has nothing to
# look up on Sourcify/Etherscan, and the run stays hermetic.
(cd "$ROOT" && forge script script/DeployLocal.s.sol --rpc-url "$RPC_URL" --private-key "$ANVIL_DEV_KEY" \
  --broadcast --slow --disable-external-identification) \
  >"$LOG_DIR/deploy.log" 2>&1 || { tail -n 40 "$LOG_DIR/deploy.log" >&2; die "deployment failed"; }

# forge's broadcast record is the source of truth for what was deployed where.
deployment="$(node - "$BROADCAST" <<'JS'
const record = JSON.parse(require("node:fs").readFileSync(process.argv[2], "utf8"));
if (record.chain !== 31337) throw new Error(`broadcast is for chain ${record.chain}, expected 31337`);
const created = (name) => {
  const tx = record.transactions.find((t) => t.transactionType === "CREATE" && t.contractName === name);
  if (!tx) throw new Error(`no ${name} deployment in the broadcast`);
  const receipt = record.receipts.find((r) => r.transactionHash === tx.hash);
  if (!receipt || receipt.status !== "0x1") throw new Error(`${name} deployment did not succeed`);
  return { address: tx.contractAddress, block: BigInt(receipt.blockNumber) };
};
const market = created("GestureSeriesMarket");
console.log(market.address, market.block.toString());
JS
)"
read -r MARKET_ADDRESS DEPLOY_BLOCK <<<"$deployment"
log "GestureSeriesMarket at $MARKET_ADDRESS (block $DEPLOY_BLOCK)"

# ------------------------------------------------------------------- app
build_env=(
  NEXT_PUBLIC_CHAIN_ID=31337
  NEXT_PUBLIC_MARKET_ADDRESS="$MARKET_ADDRESS"
  NEXT_PUBLIC_RPC_URL="$RPC_URL"
  NEXT_PUBLIC_DEPLOY_BLOCK="$DEPLOY_BLOCK"
  # Explicitly empty, so a developer's .env.local cannot leak into the build
  # (process env beats every .env file, .env.production included).
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=
)
stamp="$(printf '%s\n' "${build_env[@]}")"
if [[ "${E2E_SKIP_BUILD:-}" == 1 && -f "$BUILD_STAMP" && "$(cat "$BUILD_STAMP")" == "$stamp" ]]; then
  log "reusing the e2e build in frontend/.next (E2E_SKIP_BUILD=1)"
else
  [[ "${E2E_SKIP_BUILD:-}" == 1 ]] && log "no e2e build of this deployment to reuse; building"
  log "building the frontend against the local deployment"
  (cd "$FRONTEND" && env "${build_env[@]}" NEXT_TELEMETRY_DISABLED=1 pnpm build)
  printf '%s\n' "$stamp" >"$BUILD_STAMP"
fi

log "starting next on $WEB_URL"
(cd "$FRONTEND" && exec env NEXT_TELEMETRY_DISABLED=1 node_modules/.bin/next start --hostname 127.0.0.1 --port "$WEB_PORT") \
  >"$LOG_DIR/next.log" 2>&1 &
NEXT_PID=$!
wait_until "$NEXT_PID" 60 "next start" curl -sf -o /dev/null "$WEB_URL/"

# ------------------------------------------------------------------ tests
export E2E_BASE_URL="$WEB_URL" E2E_RPC_URL="$RPC_URL" E2E_MARKET_ADDRESS="$MARKET_ADDRESS"
log "running playwright test $*"
# In the background + wait, so a signal reaches the trap immediately.
(cd "$FRONTEND" && exec node_modules/.bin/playwright test "$@") &
PLAYWRIGHT_PID=$!
status=0
wait "$PLAYWRIGHT_PID" || status=$?
PLAYWRIGHT_PID=""
exit "$status"
