import { describe, expect, it } from "vitest";
import {
  cstAddressForChain,
  parseAddress,
  parseAppConfig,
  resolveMarketAddress,
  resolveRoundOverride,
} from "./config";

const MARKET = "0x1111111111111111111111111111111111111111";

describe("cstAddressForChain", () => {
  it("knows the CST token on Arbitrum One", () => {
    expect(cstAddressForChain(42161)).toBe("0xAD91843e6A58Ba560F577E676986AFb1dba6FBA0");
  });

  it("returns null on chains where CST is a deploy-time mock", () => {
    expect(cstAddressForChain(31337)).toBeNull();
    expect(cstAddressForChain(1)).toBeNull();
  });
});

describe("parseAddress", () => {
  it("returns null for absent values", () => {
    expect(parseAddress(undefined, "X")).toBeNull();
    expect(parseAddress("", "X")).toBeNull();
    expect(parseAddress("   ", "X")).toBeNull();
  });

  it("checksums valid addresses", () => {
    expect(parseAddress("0x6a714ae7b5b6ea520f6bca23d2e609c4fd5863f2", "X")).toBe(
      "0x6a714Ae7B5b6eA520F6BCA23d2E609C4Fd5863F2",
    );
  });

  it("throws on malformed addresses", () => {
    expect(() => parseAddress("0x123", "MY_VAR")).toThrow(/MY_VAR/);
    expect(() => parseAddress("not-an-address", "MY_VAR")).toThrow(/MY_VAR/);
  });
});

describe("parseAppConfig", () => {
  it("defaults to Arbitrum One with everything optional", () => {
    const config = parseAppConfig({});
    expect(config.chain.id).toBe(42161);
    expect(config.marketAddress).toBeNull();
    expect(config.rpcUrl).toBeNull();
    expect(config.walletConnectProjectId).toBeNull();
    expect(config.deployBlock).toBeNull();
  });

  it("accepts the anvil chain for local development", () => {
    const config = parseAppConfig({ chainId: "31337", marketAddress: MARKET });
    expect(config.chain.id).toBe(31337);
    expect(config.marketAddress).toBe("0x1111111111111111111111111111111111111111");
  });

  it("rejects unsupported chains with a helpful message", () => {
    expect(() => parseAppConfig({ chainId: "1" })).toThrow(/not supported/);
    expect(() => parseAppConfig({ chainId: "banana" })).toThrow(/not supported/);
  });

  it("parses the deploy block as bigint", () => {
    expect(parseAppConfig({ deployBlock: "123456789" }).deployBlock).toBe(123456789n);
    expect(() => parseAppConfig({ deployBlock: "-5" })).toThrow(/DEPLOY_BLOCK/);
    expect(() => parseAppConfig({ deployBlock: "1.5" })).toThrow(/DEPLOY_BLOCK/);
  });

  it("treats empty strings as absent", () => {
    const config = parseAppConfig({ chainId: "", marketAddress: "", rpcUrl: "", deployBlock: "" });
    expect(config.chain.id).toBe(42161);
    expect(config.marketAddress).toBeNull();
  });
});

describe("resolveMarketAddress", () => {
  const configured = "0x2222222222222222222222222222222222222222" as const;

  it("prefers a valid query override", () => {
    expect(resolveMarketAddress(configured, MARKET)).toBe(
      "0x1111111111111111111111111111111111111111",
    );
  });

  it("falls back to configured for missing or invalid overrides", () => {
    expect(resolveMarketAddress(configured, null)).toBe(configured);
    expect(resolveMarketAddress(configured, undefined)).toBe(configured);
    expect(resolveMarketAddress(configured, "0xdead")).toBe(configured);
    expect(resolveMarketAddress(configured, "javascript:alert(1)")).toBe(configured);
  });

  it("returns null when nothing is configured", () => {
    expect(resolveMarketAddress(null, "junk")).toBeNull();
  });
});

describe("resolveRoundOverride", () => {
  it("parses valid round numbers", () => {
    expect(resolveRoundOverride("0")).toBe(0n);
    expect(resolveRoundOverride("42")).toBe(42n);
    expect(resolveRoundOverride(" 7 ")).toBe(7n);
  });

  it("ignores missing or malformed values (follow the live round instead)", () => {
    expect(resolveRoundOverride(null)).toBeNull();
    expect(resolveRoundOverride(undefined)).toBeNull();
    expect(resolveRoundOverride("")).toBeNull();
    expect(resolveRoundOverride("-1")).toBeNull();
    expect(resolveRoundOverride("1.5")).toBeNull();
    expect(resolveRoundOverride("banana")).toBeNull();
  });
});
