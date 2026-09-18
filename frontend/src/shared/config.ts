import { parseAddress } from "@/lib/config";

/** Deliberately separate from the deployed, legacy GestureSeriesMarket address. */
export const sharedMarketAddress = parseAddress(
  process.env.NEXT_PUBLIC_SHARED_MARKET_ADDRESS,
  "NEXT_PUBLIC_SHARED_MARKET_ADDRESS",
);
