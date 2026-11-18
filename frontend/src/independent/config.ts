import { ARBITRUM_OUTCOME_SOURCE, ARBITRUM_PREVIOUS_MARKET } from "@/lib/contracts";
import { appConfig, parseAddress } from "@/lib/config";

/** Keep the original eight-pool address available for claims across a V4 cutover. */
const configuredIndependentMarket = parseAddress(
  process.env.NEXT_PUBLIC_INDEPENDENT_MARKET_ADDRESS,
  "NEXT_PUBLIC_INDEPENDENT_MARKET_ADDRESS",
);
export const previousMarketAddress =
  appConfig.chain.id === 42161 ? ARBITRUM_PREVIOUS_MARKET : configuredIndependentMarket;
export const gameFundedMarketAddress = parseAddress(
  process.env.NEXT_PUBLIC_GAME_FUNDED_MARKET_ADDRESS,
  "NEXT_PUBLIC_GAME_FUNDED_MARKET_ADDRESS",
);
if (
  gameFundedMarketAddress &&
  appConfig.chain.id === 42161 &&
  parseAddress(
    process.env.NEXT_PUBLIC_INDEPENDENT_SOURCE_ADDRESS,
    "NEXT_PUBLIC_INDEPENDENT_SOURCE_ADDRESS",
  ) !== ARBITRUM_OUTCOME_SOURCE
)
  throw new Error("The successor must use the verified eight-question outcome adapter.");
if (gameFundedMarketAddress && !previousMarketAddress)
  throw new Error(
    "Configure the original eight-pool market for previous positions before cutover.",
  );
if (gameFundedMarketAddress && gameFundedMarketAddress === previousMarketAddress)
  throw new Error("The game-funded and previous markets must have different addresses.");

export const independentMarketAddress = gameFundedMarketAddress ?? configuredIndependentMarket;
