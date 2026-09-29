import type { Address } from "viem";
import { getAddress } from "viem";

/**
 * What the suite knows about the stack under test, read from the environment.
 *
 * `tools/e2e.sh` provisions everything (anvil + deployment + production
 * build + server) and exports these; they can also be set by hand to run
 * `pnpm test:e2e` against a stack you started yourself.
 */

/** Port `next start` listens on when Playwright starts the server itself. */
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3100);

/**
 * The app under test. Defaults to the local production server; point it at a
 * deployment (e.g. a preview URL) to run the chain-agnostic suites there:
 * `E2E_BASE_URL=https://… pnpm test:e2e --grep-invert @chain`.
 */
export const BASE_URL = process.env.E2E_BASE_URL?.trim() || `http://127.0.0.1:${WEB_PORT}`;

/** The local chain the app was built against (anvil, chain id 31337). */
export interface LocalChainEnv {
  readonly rpcUrl: string;
  readonly market: Address;
}

/** The local chain, or `null` when the suite runs against a remote deployment. */
export function localChainEnv(): LocalChainEnv | null {
  const rpcUrl = process.env.E2E_RPC_URL?.trim();
  const market = process.env.E2E_MARKET_ADDRESS?.trim();
  if (!rpcUrl && !market) return null;
  if (!rpcUrl || !market) {
    throw new Error("Set both E2E_RPC_URL and E2E_MARKET_ADDRESS (or neither).");
  }
  return { rpcUrl, market: getAddress(market) };
}

/** Like {@link localChainEnv}, but for suites that cannot run without the local chain. */
export function requireLocalChainEnv(): LocalChainEnv {
  const env = localChainEnv();
  if (env === null) {
    throw new Error(
      "This test drives the local anvil chain, but E2E_RPC_URL / E2E_MARKET_ADDRESS are not set. " +
        "Run the full stack with tools/e2e.sh, or skip chain tests with --grep-invert @chain.",
    );
  }
  return env;
}
