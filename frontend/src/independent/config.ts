import { parseAddress } from "@/lib/config";

/** Independent pools have their own ABI and never inherit a legacy market address. */
export const independentMarketAddress = parseAddress(
  process.env.NEXT_PUBLIC_INDEPENDENT_MARKET_ADDRESS,
  "NEXT_PUBLIC_INDEPENDENT_MARKET_ADDRESS",
);
