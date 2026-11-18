import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ARBITRUM_OUTCOME_SOURCE, ARBITRUM_PREVIOUS_MARKET } from "@/lib/contracts";

const candidate = "0x1111111111111111111111111111111111111111";
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "42161");
  vi.stubEnv("NEXT_PUBLIC_INDEPENDENT_MARKET_ADDRESS", ARBITRUM_PREVIOUS_MARKET);
  vi.stubEnv("NEXT_PUBLIC_INDEPENDENT_SOURCE_ADDRESS", ARBITRUM_OUTCOME_SOURCE);
  vi.stubEnv("NEXT_PUBLIC_GAME_FUNDED_MARKET_ADDRESS", "");
});
afterEach(() => vi.unstubAllEnvs());

it("preserves the published V3 default until a successor is selected", async () => {
  expect((await import("./config")).independentMarketAddress).toBe(ARBITRUM_PREVIOUS_MARKET);
});
it("keeps historical positions pinned when switching the primary market", async () => {
  vi.stubEnv("NEXT_PUBLIC_GAME_FUNDED_MARKET_ADDRESS", candidate);
  vi.stubEnv("NEXT_PUBLIC_INDEPENDENT_MARKET_ADDRESS", "");
  const { independentMarketAddress, previousMarketAddress } = await import("./config");
  expect(independentMarketAddress).toBe(candidate);
  expect(previousMarketAddress).toBe(ARBITRUM_PREVIOUS_MARKET);
});
it("rejects pointing either the game-funded interface or outcome adapter at the wrong deployment", async () => {
  vi.stubEnv("NEXT_PUBLIC_GAME_FUNDED_MARKET_ADDRESS", ARBITRUM_PREVIOUS_MARKET);
  await expect(import("./config")).rejects.toThrow(/different addresses/);
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_GAME_FUNDED_MARKET_ADDRESS", candidate);
  vi.stubEnv("NEXT_PUBLIC_INDEPENDENT_SOURCE_ADDRESS", candidate);
  await expect(import("./config")).rejects.toThrow(/verified eight-question/);
});
