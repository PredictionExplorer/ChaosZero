import { afterEach, describe, expect, it, vi } from "vitest";
import { ARBITRUM_CST_ADDRESS, COSMIC_GAME_ADDRESS } from "@/lib/contracts";
import { SOURCE, TOKEN, GAME } from "./test-fixtures";
import { assertProductionMarket, isMarketChain } from "./deployment";

afterEach(() => vi.unstubAllEnvs());
describe("immutable production deployment identity", () => {
  it("allows only Arbitrum One or the explicit local test chain", () => {
    expect(isMarketChain(42161)).toBe(true);
    expect(isMarketChain(31337)).toBe(true);
    expect(isMarketChain(1)).toBe(false);
    expect(() => assertProductionMarket(1, TOKEN, SOURCE, GAME)).toThrow(/Arbitrum/);
  });
  it("permits disposable addresses on the local test chain", () => {
    expect(() => assertProductionMarket(31337, TOKEN, SOURCE, GAME)).not.toThrow();
  });
  it("requires an explicitly pinned production source", () => {
    vi.stubEnv("NEXT_PUBLIC_INDEPENDENT_SOURCE_ADDRESS", "");
    expect(() =>
      assertProductionMarket(42161, ARBITRUM_CST_ADDRESS, SOURCE, COSMIC_GAME_ADDRESS),
    ).toThrow(/not been configured/);
  });
  it("checks all three identities instead of trusting the market's own references", () => {
    vi.stubEnv("NEXT_PUBLIC_INDEPENDENT_SOURCE_ADDRESS", SOURCE);
    expect(() =>
      assertProductionMarket(42161, ARBITRUM_CST_ADDRESS, SOURCE, COSMIC_GAME_ADDRESS),
    ).not.toThrow();
    expect(() => assertProductionMarket(42161, TOKEN, SOURCE, COSMIC_GAME_ADDRESS)).toThrow(
      /does not match/,
    );
    expect(() =>
      assertProductionMarket(42161, ARBITRUM_CST_ADDRESS, TOKEN, COSMIC_GAME_ADDRESS),
    ).toThrow(/does not match/);
    expect(() => assertProductionMarket(42161, ARBITRUM_CST_ADDRESS, SOURCE, GAME)).toThrow(
      /does not match/,
    );
  });
});
