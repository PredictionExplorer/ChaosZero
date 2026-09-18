import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  claimable,
  feasibleReserves,
  log2Bounds,
  MAX_COLLATERAL,
  ONE,
  productAccepts,
  quoteTrade,
  tradeState,
  yesProbabilityBps,
  type SharedPool,
} from "./math";

const pool = (overrides: Partial<SharedPool> = {}): SharedPool => ({
  collateral: 1000n * ONE,
  yes: Array<bigint>(8).fill(0n),
  no: Array<bigint>(8).fill(0n),
  knownMask: 0,
  values: 0,
  ...overrides,
});

/** Independent integer reference for the true invariant; never uses logarithms. */
const product = (state: SharedPool) =>
  feasibleReserves(state).reduce((result, row) => result * row.reserve, 1n);

describe("shared product quotes", () => {
  it("encloses exact powers of two without a rounding spread", () => {
    for (let exponent = 0n; exponent <= 120n; exponent++)
      expect(log2Bounds(1n << exponent)).toEqual([exponent << 64n, exponent << 64n]);
    expect(() => log2Bounds(0n)).toThrow();
    expect(() => log2Bounds(MAX_COLLATERAL + 1n)).toThrow();
  });

  it("encloses independent high-precision rational exponent comparisons", () => {
    // log2(3) = 1.58496250072115618145373894394781650875981440769248...
    const floor = 29237397617229858719n;
    const [lower, upper] = log2Bounds(3n);
    expect(lower).toBeLessThanOrEqual(floor);
    expect(upper).toBeGreaterThanOrEqual(floor + 1n);
    expect(upper - lower).toBeLessThanOrEqual(4n);
  });

  it("starts every question at even odds but distinguishes an unfunded pool", () => {
    for (let i = 0; i < 8; i++) expect(yesProbabilityBps(pool(), i)).toBe(5000n);
    expect(yesProbabilityBps(pool({ collateral: 0n }), 0)).toBeNull();
  });

  it("matches the analytic two-reserve buy bound when all questions are initially symmetric", () => {
    const state = pool();
    const cash = 10n * ONE;
    const quote = quoteTrade(state, 0, true, true, cash);
    const exact =
      state.collateral +
      cash -
      (state.collateral ** 2n + state.collateral + cash - 1n) / (state.collateral + cash);
    expect(quote).toBeLessThanOrEqual(exact);
    expect(exact - quote).toBeLessThan(100_000n);
    expect(productAccepts(state, tradeState(state, 0, true, true, cash, quote))).toBe(true);
    expect(yesProbabilityBps(tradeState(state, 0, true, true, cash, quote), 0)).toBeGreaterThan(
      5000n,
    );
  });

  it("cannot extract sponsor funds through a buy/sell round trip", () => {
    const initial = pool();
    const units = quoteTrade(initial, 0, true, true, 10n * ONE);
    const bought = tradeState(initial, 0, true, true, 10n * ONE, units);
    const proceeds = quoteTrade(bought, 0, true, false, units);
    expect(proceeds).toBeGreaterThan(0n);
    expect(proceeds).toBeLessThanOrEqual(10n * ONE);
    expect(productAccepts(bought, tradeState(bought, 0, true, false, proceeds, units))).toBe(true);
  });

  it("uses all questions' liabilities when quoting one question", () => {
    const initial = pool();
    const first = tradeState(
      initial,
      1,
      true,
      true,
      100n * ONE,
      quoteTrade(initial, 1, true, true, 100n * ONE),
    );
    expect(quoteTrade(first, 0, true, true, 100n * ONE)).not.toBe(
      quoteTrade(pool({ collateral: first.collateral }), 0, true, true, 100n * ONE),
    );
  });

  it("honors partial settlement and rejects trading a known answer", () => {
    const state = pool({ knownMask: 3, values: 1 });
    expect(feasibleReserves(state)).toHaveLength(64);
    expect(yesProbabilityBps(state, 0)).toBe(10_000n);
    expect(yesProbabilityBps(state, 1)).toBe(0n);
    expect(quoteTrade(state, 0, true, true, ONE)).toBe(0n);
    expect(quoteTrade(state, 2, true, true, ONE)).toBeGreaterThan(0n);
  });

  it("returns no quote for dust that cannot satisfy the conservative proof", () => {
    expect(quoteTrade(pool(), 0, true, true, 1n)).toBe(0n);
    expect(quoteTrade(pool(), 0, true, true, 37n)).toBe(0n);
    expect(quoteTrade(pool(), 0, true, true, 38n)).toBe(38n);
    expect(productAccepts(pool(), tradeState(pool(), 0, true, true, 38n, 38n))).toBe(true);
  });

  it("checks limits and collateral positivity", () => {
    expect(quoteTrade(pool(), 8, true, true, ONE)).toBe(0n);
    expect(quoteTrade(pool(), 0, true, true, 0n)).toBe(0n);
    expect(quoteTrade(pool(), 0, true, false, ONE)).toBe(0n);
    expect(quoteTrade(pool({ collateral: MAX_COLLATERAL }), 0, true, true, 1n)).toBe(0n);
    expect(productAccepts(pool(), pool({ collateral: 0n }))).toBe(false);
    expect(productAccepts(pool(), pool({ knownMask: 1, values: 1 }))).toBe(false);
  });

  it("accepted random trades preserve the exact product, not just a floating approximation", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 2000 }),
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 0, max: 7 }),
        fc.boolean(),
        (fund, input, question, yes) => {
          const before = pool({ collateral: BigInt(fund) * ONE });
          const cash = BigInt(input) * ONE;
          const output = quoteTrade(before, question, yes, true, cash);
          expect(output).toBeGreaterThan(0n);
          const after = tradeState(before, question, yes, true, cash, output);
          expect(product(after)).toBeGreaterThanOrEqual(product(before));
          expect(feasibleReserves(after).every((row) => row.reserve > 0n)).toBe(true);
        },
      ),
      { numRuns: 24 },
    );
  });

  it("preserves exact products across asymmetric liabilities and partial known answers", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 30 }), { minLength: 16, maxLength: 16 }),
        fc.integer({ min: 1, max: 7 }),
        fc.boolean(),
        fc.boolean(),
        (amounts, question, yes, knownYes) => {
          const before = pool({
            collateral: 1000n * ONE,
            yes: amounts.slice(0, 8).map((x) => BigInt(x) * ONE),
            no: amounts.slice(8).map((x) => BigInt(x) * ONE),
            knownMask: 1,
            values: knownYes ? 1 : 0,
          });
          const output = quoteTrade(before, question, yes, true, 10n * ONE);
          const after = tradeState(before, question, yes, true, 10n * ONE, output);
          expect(output).toBeGreaterThan(0n);
          expect(productAccepts(before, after)).toBe(true);
          expect(product(after)).toBeGreaterThanOrEqual(product(before));
          expect(
            productAccepts(before, tradeState(before, question, yes, true, 10n * ONE, output + 1n)),
          ).toBe(false);
        },
      ),
      { numRuns: 12 },
    );
  });

  it("rejects corrupted ledger states instead of admitting a quote or invalid price", () => {
    const initial = pool();
    const bad = [
      pool({ yes: [0n] }),
      pool({ collateral: -1n }),
      pool({ collateral: MAX_COLLATERAL + 1n }),
      pool({ knownMask: -1 }),
      pool({ knownMask: 256 }),
      pool({ knownMask: 0, values: 1 }),
      pool({ yes: [-1n, ...Array<bigint>(7).fill(0n)] }),
      pool({ no: [-1n, ...Array<bigint>(7).fill(0n)] }),
    ];
    for (const state of bad) {
      expect(() => feasibleReserves(state)).toThrow();
      expect(productAccepts(state, initial)).toBe(false);
    }
    const insolvent = pool({ yes: [initial.collateral, ...Array<bigint>(7).fill(0n)] });
    expect(yesProbabilityBps(insolvent, 0)).toBeNull();
    expect(productAccepts(insolvent, pool({ collateral: initial.collateral + ONE }))).toBe(false);
    expect(
      productAccepts(pool({ knownMask: 1, values: 0 }), pool({ knownMask: 1, values: 1 })),
    ).toBe(false);
    expect(quoteTrade(pool({ collateral: 0n }), 0, true, true, ONE)).toBe(0n);
    expect(quoteTrade(pool(), -1, true, true, ONE)).toBe(0n);
    expect(quoteTrade(pool(), 0.5, true, true, ONE)).toBe(0n);
    expect(quoteTrade(pool(), 0, true, true, MAX_COLLATERAL + 1n)).toBe(0n);
  });

  it("backs a NO purchase and sale with the same exact-product guarantee", () => {
    const before = pool({ knownMask: 1, values: 1 });
    const units = quoteTrade(before, 2, false, true, 20n * ONE);
    const bought = tradeState(before, 2, false, true, 20n * ONE, units);
    const proceeds = quoteTrade(bought, 2, false, false, units);
    const sold = tradeState(bought, 2, false, false, proceeds, units);
    expect(proceeds).toBeGreaterThan(0n);
    expect(proceeds).toBeLessThanOrEqual(20n * ONE);
    expect(product(sold)).toBeGreaterThanOrEqual(product(bought));
    expect(sold.no[2]).toBe(0n);
  });

  it("only pays known winning balances, including NO answers", () => {
    const yes = [4n, 6n, 8n, 0n, 0n, 0n, 0n, 0n];
    const no = [3n, 5n, 7n, 0n, 0n, 0n, 0n, 0n];
    expect(claimable(yes, no, 3, 1)).toBe(9n);
    expect(claimable(yes, no, 0, 0)).toBe(0n);
    expect(claimable(yes, no, 255, 0)).toBe(15n);
  });
});
