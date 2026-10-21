import { getAddress, type Address } from "viem";
import { ARBITRUM_CST_ADDRESS, COSMIC_GAME_ADDRESS } from "@/lib/contracts";

export const isMarketChain = (chainId: number) => chainId === 31337 || chainId === 42161;

/** Pin the immutable adapter separately from the market before enabling real CST. */
export function assertProductionMarket(
  chainId: number,
  token: Address,
  source: Address,
  game: Address,
) {
  if (chainId === 31337) return;
  if (chainId !== 42161) throw new Error("Use the configured Arbitrum One network.");
  const expectedSource = process.env.NEXT_PUBLIC_INDEPENDENT_SOURCE_ADDRESS?.trim();
  if (!expectedSource) throw new Error("The production outcome source has not been configured.");
  if (
    getAddress(token) !== getAddress(ARBITRUM_CST_ADDRESS) ||
    getAddress(game) !== getAddress(COSMIC_GAME_ADDRESS) ||
    getAddress(source) !== getAddress(expectedSource)
  )
    throw new Error("The market's token, outcome source or game does not match this deployment.");
}
