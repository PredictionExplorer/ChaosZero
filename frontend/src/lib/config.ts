import type { Address, Chain } from "viem";
import { getAddress } from "viem";
import { anvil, arbitrum } from "viem/chains";

/** Chains the app knows how to talk to. Arbitrum One in production, Anvil for local dev. */
export const SUPPORTED_CHAINS: readonly Chain[] = [arbitrum, anvil];

export const DEFAULT_CHAIN_ID = arbitrum.id;

/** Cosmic Signature game proxy on Arbitrum One (informational; the market stores its own reference). */
export const COSMIC_GAME_ADDRESS: Address = "0x6a714Ae7B5b6eA520F6BCA23d2E609C4Fd5863F2";

/** CST token on Arbitrum One (public constant, used for explorer links). */
const ARBITRUM_CST_ADDRESS: Address = "0xAD91843e6A58Ba560F577E676986AFb1dba6FBA0";

/**
 * The CST address knowable without an RPC call: fixed on Arbitrum One, but on
 * local sandboxes the mock CST lives wherever the deploy script put it.
 */
export function cstAddressForChain(chainId: number): Address | null {
  return chainId === arbitrum.id ? ARBITRUM_CST_ADDRESS : null;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export interface AppConfig {
  /** The single chain this deployment targets. */
  readonly chain: Chain;
  /** The GestureSeriesMarket singleton (`?market=` overrides). `null` = not configured. */
  readonly marketAddress: Address | null;
  /** Optional RPC override; falls back to the chain's public RPC. */
  readonly rpcUrl: string | null;
  /** WalletConnect Cloud project id; the WalletConnect option is hidden without it. */
  readonly walletConnectProjectId: string | null;
  /** Block to start event scans from (the market's deploy block). `null` = from genesis. */
  readonly deployBlock: bigint | null;
}

export interface RawEnv {
  readonly chainId?: string | undefined;
  readonly marketAddress?: string | undefined;
  readonly rpcUrl?: string | undefined;
  readonly walletConnectProjectId?: string | undefined;
  readonly deployBlock?: string | undefined;
}

/** Normalizes an env var: trims and treats empty strings as absent. */
function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Parses and validates a checksummed EVM address. Returns `null` for absent input,
 * throws a descriptive error for present-but-malformed input (fail loudly at startup
 * rather than silently pointing the app at garbage).
 */
export function parseAddress(value: string | undefined, label: string): Address | null {
  const raw = clean(value);
  if (raw === null) return null;
  if (!ADDRESS_RE.test(raw)) {
    throw new Error(`${label} is not a valid address: "${raw}"`);
  }
  return getAddress(raw.toLowerCase());
}

/** Builds the validated app config from raw environment values. */
export function parseAppConfig(raw: RawEnv): AppConfig {
  const chainIdStr = clean(raw.chainId);
  const chainId = chainIdStr === null ? DEFAULT_CHAIN_ID : Number(chainIdStr);
  const chain = SUPPORTED_CHAINS.find((c) => c.id === chainId);
  if (!chain || !Number.isInteger(chainId)) {
    const supported = SUPPORTED_CHAINS.map((c) => `${c.id} (${c.name})`).join(", ");
    throw new Error(
      `NEXT_PUBLIC_CHAIN_ID "${chainIdStr}" is not supported. Use one of: ${supported}`,
    );
  }

  const deployBlockStr = clean(raw.deployBlock);
  let deployBlock: bigint | null = null;
  if (deployBlockStr !== null) {
    if (!/^\d+$/.test(deployBlockStr)) {
      throw new Error(
        `NEXT_PUBLIC_DEPLOY_BLOCK must be a non-negative integer, got "${deployBlockStr}"`,
      );
    }
    deployBlock = BigInt(deployBlockStr);
  }

  return {
    chain,
    marketAddress: parseAddress(raw.marketAddress, "NEXT_PUBLIC_MARKET_ADDRESS"),
    rpcUrl: clean(raw.rpcUrl),
    walletConnectProjectId: clean(raw.walletConnectProjectId),
    deployBlock,
  };
}

/**
 * Picks the series contract to display: a valid `?market=0x…` query param
 * wins over the configured default (useful for testing new deployments).
 * Invalid overrides are ignored rather than breaking the page.
 */
export function resolveMarketAddress(
  configured: Address | null,
  queryParam: string | null | undefined,
): Address | null {
  if (queryParam && ADDRESS_RE.test(queryParam.trim())) {
    return getAddress(queryParam.trim().toLowerCase());
  }
  return configured;
}

/**
 * Picks the round to display: a valid `?round=N` query param shows a past (or
 * specific) round; otherwise the app follows the game's current round live.
 * Invalid overrides are ignored rather than breaking the page.
 */
export function resolveRoundOverride(queryParam: string | null | undefined): bigint | null {
  const raw = queryParam?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  return BigInt(raw);
}

/**
 * The app-wide config singleton. `NEXT_PUBLIC_*` vars are inlined at build time,
 * so they must be referenced literally here.
 */
export const appConfig: AppConfig = parseAppConfig({
  chainId: process.env.NEXT_PUBLIC_CHAIN_ID,
  marketAddress: process.env.NEXT_PUBLIC_MARKET_ADDRESS,
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL,
  walletConnectProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
  deployBlock: process.env.NEXT_PUBLIC_DEPLOY_BLOCK,
});

/** CST on this deployment's chain, when statically knowable (see {@link cstAddressForChain}). */
export const COSMIC_CST_ADDRESS: Address | null = cstAddressForChain(appConfig.chain.id);
