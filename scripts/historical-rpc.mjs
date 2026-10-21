import { setTimeout as delay } from "node:timers/promises";

export const HISTORY_RPCS = Object.freeze({
  logs: "https://arb1.arbitrum.io/rpc",
  headers: "https://arbitrum-one-rpc.publicnode.com",
  receipts: "https://arbitrum.drpc.org",
});
const READ_METHODS = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_getLogs",
  "eth_getBlockByNumber",
  "eth_getTransactionReceipt",
  "eth_call",
  "eth_getStorageAt",
]);

/** Public endpoints only, and an explicit read-only RPC method allowlist. */
export async function readRpcBatch(
  endpoint,
  calls,
  { fetcher = fetch, wait = delay, attempts = 8 } = {},
) {
  if (
    !Object.values(HISTORY_RPCS).includes(endpoint) ||
    calls.some((call) => !READ_METHODS.has(call.method))
  )
    throw new Error(
      "Historical verification accepts only fixed public endpoints and read-only RPC methods",
    );
  const payload = calls.map((call, id) => ({
    jsonrpc: "2.0",
    id,
    method: call.method,
    params: call.params,
  }));
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetcher(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error("RPC HTTP request failed");
      const raw = await response.json();
      if (!Array.isArray(raw) || raw.length !== payload.length)
        throw new Error("RPC batch response count mismatch");
      const byId = new Map(raw.map((entry) => [entry.id, entry]));
      if (byId.size !== payload.length || payload.some((entry) => !byId.has(entry.id)))
        throw new Error("RPC batch response ID mismatch");
      const result = payload.map(({ id }) => byId.get(id));
      if (
        result.some((entry) => entry.error || entry.result === undefined || entry.result === null)
      )
        throw new Error("RPC did not return all requested historical values");
      return result.map((entry) => entry.result);
    } catch {
      if (attempt + 1 === attempts)
        throw new Error(
          "Public historical RPC requests failed after bounded retries; no result was assumed",
        );
      await wait(Math.min(3000, 300 * 2 ** attempt));
    }
  }
}
