import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { MAX_COLLATERAL, ONE } from "./math";
import {
  independentTradeState,
  independentYesProbabilityBps,
  questionReserves,
  quoteIndependentTrade,
  weightedProductAccepts,
  type BinaryQuestionPool,
} from "./independent-math";

const pool = (overrides: Partial<BinaryQuestionPool> = {}): BinaryQuestionPool => ({
  collateral: 1000n * ONE,
  yes: 0n,
  no: 0n,
  initialYesBps: 5000,
  ...overrides,
});
const mirror = (state: BinaryQuestionPool): BinaryQuestionPool => ({
  ...state,
  yes: state.no,
  no: state.yes,
  initialYesBps: 10_000 - state.initialYesBps,
});
const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));
/** Independent exact-integer invariant oracle: no logarithms or floating point. */
function exactProduct(state: BinaryQuestionPool): bigint {
  const reserves = questionReserves(state);
  const yesWeight = BigInt(state.initialYesBps);
  const noWeight = 10_000n - yesWeight;
  const divisor = gcd(yesWeight, noWeight);
  return reserves.yes ** (yesWeight / divisor) * reserves.no ** (noWeight / divisor);
}
const validState = fc.record({
  collateral: fc.bigInt({ min: 1000n, max: 1_000_000n }),
  yes: fc.bigInt({ min: 0n, max: 499n }),
  no: fc.bigInt({ min: 0n, max: 499n }),
  initialYesBps: fc.integer({ min: 1, max: 9999 }),
});

describe("independent weighted question math", () => {
  it("initializes at the prescribed probability and rejects zero-reserve price claims", () => {
    for (const weight of [1, 4000, 5000, 6000, 9999])
      expect(independentYesProbabilityBps(pool({ initialYesBps: weight }))).toBe(BigInt(weight));
    expect(independentYesProbabilityBps(pool({ collateral: 0n }))).toBeNull();
    expect(independentYesProbabilityBps(pool({ collateral: ONE, yes: ONE, no: ONE }))).toBeNull();
    expect(independentYesProbabilityBps(pool({ yes: 1001n * ONE }))).toBeNull();
    expect(independentYesProbabilityBps(pool({ no: 1001n * ONE }))).toBeNull();
  });

  it("computes the exact rational marginal price before BPS truncation", () => {
    const state = pool({ collateral: 1000n, yes: 200n, no: 500n, initialYesBps: 4000 });
    expect(questionReserves(state)).toEqual({ yes: 800n, no: 500n });
    expect(independentYesProbabilityBps(state)).toBe(2941n);
    expect(
      independentYesProbabilityBps(
        pool({ collateral: MAX_COLLATERAL, no: MAX_COLLATERAL - 1n, initialYesBps: 1 }),
      ),
    ).toBe(0n);
    expect(
      independentYesProbabilityBps(
        pool({ collateral: MAX_COLLATERAL, yes: MAX_COLLATERAL - 1n, initialYesBps: 9999 }),
      ),
    ).toBe(9999n);
  });

  it("rejects malformed weights, balances, amounts, and collateral overflow", () => {
    const invalid = [
      ...[0, 10_000, -1, 5000.5, Number.NaN, Number.POSITIVE_INFINITY].map((initialYesBps) =>
        pool({ initialYesBps }),
      ),
      pool({ collateral: -1n }),
      pool({ collateral: MAX_COLLATERAL + 1n }),
      pool({ yes: -1n }),
      pool({ no: -1n }),
      pool({ yes: MAX_COLLATERAL + 1n }),
      pool({ no: MAX_COLLATERAL + 1n }),
    ];
    for (const state of invalid) {
      expect(() => questionReserves(state)).toThrow();
      expect(weightedProductAccepts(state, pool())).toBe(false);
      expect(quoteIndependentTrade(state, true, true, ONE)).toBe(0n);
      expect(independentYesProbabilityBps(state)).toBeNull();
    }
    for (const input of [0n, -1n, MAX_COLLATERAL + 1n])
      expect(quoteIndependentTrade(pool(), true, true, input)).toBe(0n);
    expect(quoteIndependentTrade(pool({ collateral: MAX_COLLATERAL }), true, true, 1n)).toBe(0n);
    expect(quoteIndependentTrade(pool(), true, false, 1n)).toBe(0n);
    expect(quoteIndependentTrade(pool(), false, false, 1n)).toBe(0n);
    // A sale cannot consume the final wei backing the other outcome.
    expect(quoteIndependentTrade(pool({ collateral: 3n, yes: 1n, no: 2n }), true, false, 1n)).toBe(
      0n,
    );
    expect(quoteIndependentTrade(pool({ collateral: 3n, yes: 2n, no: 1n }), false, false, 1n)).toBe(
      0n,
    );
    expect(quoteIndependentTrade(pool({ no: 1000n * ONE }), false, true, ONE)).toBe(0n);
    expect(quoteIndependentTrade(pool({ yes: 1000n * ONE }), true, true, ONE)).toBe(0n);
    expect(weightedProductAccepts(pool(), pool({ initialYesBps: 6000 }))).toBe(false);
    expect(weightedProductAccepts(pool(), pool({ yes: 1000n * ONE }))).toBe(false);
    expect(weightedProductAccepts(pool(), pool({ no: 1000n * ONE }))).toBe(false);
    expect(weightedProductAccepts(pool({ yes: 1000n * ONE }), pool())).toBe(false);
    expect(weightedProductAccepts(pool({ no: 1000n * ONE }), pool())).toBe(false);
  });

  it("cancels unchanged factors, including an isolated admissible dust quote", () => {
    expect(weightedProductAccepts(pool(), pool())).toBe(true);
    expect(quoteIndependentTrade(pool(), true, true, 1n)).toBe(0n);
    expect(quoteIndependentTrade(pool(), true, true, 37n)).toBe(0n);
    expect(quoteIndependentTrade(pool(), true, true, 38n)).toBe(38n);
    expect(
      weightedProductAccepts(pool(), independentTradeState(pool(), true, true, 38n, 38n)),
    ).toBe(true);
    expect(quoteIndependentTrade(pool({ collateral: 1n, yes: 0n, no: 0n }), true, true, 1n)).toBe(
      1n,
    );
  });

  it("matches the 50/50 analytic limit conservatively", () => {
    const state = pool();
    const input = 10n * ONE;
    const exact =
      state.collateral +
      input -
      (state.collateral ** 2n + state.collateral + input - 1n) / (state.collateral + input);
    const quoted = quoteIndependentTrade(state, true, true, input);
    expect(quoted).toBeLessThanOrEqual(exact);
    expect(exact - quoted).toBeLessThan(100_000n);
    expect(
      weightedProductAccepts(state, independentTradeState(state, true, true, input, quoted)),
    ).toBe(true);
    expect(
      weightedProductAccepts(state, independentTradeState(state, true, true, input, quoted + 1n)),
    ).toBe(false);
  });

  it("is symmetric when YES/NO and their fixed weights are exchanged", () => {
    fc.assert(
      fc.property(
        validState,
        fc.bigInt({ min: 1n, max: 1000n }),
        fc.boolean(),
        (state, input, yes) => {
          expect(quoteIndependentTrade(state, yes, true, input)).toBe(
            quoteIndependentTrade(mirror(state), !yes, true, input),
          );
          const sellInput = yes ? state.yes : state.no;
          expect(quoteIndependentTrade(state, yes, false, sellInput)).toBe(
            quoteIndependentTrade(mirror(state), !yes, false, sellInput),
          );
          const sum =
            independentYesProbabilityBps(state)! + independentYesProbabilityBps(mirror(state))!;
          expect(sum === 9999n || sum === 10_000n).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  }, 30_000);

  it("preserves the exact weighted product for random buys and sells, with maximal accepted outputs", () => {
    fc.assert(
      fc.property(
        validState,
        fc.bigInt({ min: 1n, max: 1000n }),
        fc.boolean(),
        (state, input, yes) => {
          const output = quoteIndependentTrade(state, yes, true, input);
          expect(output).toBeGreaterThan(0n);
          const bought = independentTradeState(state, yes, true, input, output);
          expect(weightedProductAccepts(state, bought)).toBe(true);
          expect(exactProduct(bought)).toBeGreaterThanOrEqual(exactProduct(state));
          expect(
            weightedProductAccepts(
              state,
              independentTradeState(state, yes, true, input, output + 1n),
            ),
          ).toBe(false);
          const proceeds = quoteIndependentTrade(bought, yes, false, output);
          if (proceeds > 0n) {
            const sold = independentTradeState(bought, yes, false, proceeds, output);
            expect(weightedProductAccepts(bought, sold)).toBe(true);
            expect(exactProduct(sold)).toBeGreaterThanOrEqual(exactProduct(bought));
            expect(proceeds).toBeLessThanOrEqual(input);
            expect(
              weightedProductAccepts(
                bought,
                independentTradeState(bought, yes, false, proceeds + 1n, output),
              ),
            ).toBe(false);
          }
        },
      ),
      { numRuns: 180 },
    );
  }, 30_000);

  it("keeps split/merge prices and every reserve unchanged", () => {
    fc.assert(
      fc.property(validState, fc.bigInt({ min: 1n, max: 10n ** 25n }), (state, amount) => {
        const split = {
          ...state,
          collateral: state.collateral + amount,
          yes: state.yes + amount,
          no: state.no + amount,
        };
        expect(questionReserves(split)).toEqual(questionReserves(state));
        expect(independentYesProbabilityBps(split)).toBe(independentYesProbabilityBps(state));
        expect(weightedProductAccepts(state, split)).toBe(true);
        expect(quoteIndependentTrade(split, true, true, 100n)).toBe(
          quoteIndependentTrade(state, true, true, 100n),
        );
        const merged = {
          ...split,
          collateral: split.collateral - amount,
          yes: split.yes - amount,
          no: split.no - amount,
        };
        expect(merged).toEqual(state);
        expect(weightedProductAccepts(split, merged)).toBe(true);
      }),
      { numRuns: 200 },
    );
  }, 30_000);

  it("cannot change another question's price or quote by trading or funding this one", () => {
    fc.assert(
      fc.property(
        fc.array(validState, { minLength: 8, maxLength: 8 }),
        fc.integer({ min: 0, max: 7 }),
        (states, changed) => {
          const originals = states.map((state) => ({ ...state }));
          const prices = states.map(independentYesProbabilityBps);
          const quotes = states.map((state) => quoteIndependentTrade(state, true, true, 100n));
          const selected = states[changed];
          states[changed] = independentTradeState(selected, true, true, 100n, quotes[changed]);
          states[changed] = { ...states[changed], collateral: states[changed].collateral + 500n };
          for (let i = 0; i < 8; i++)
            if (i !== changed) {
              expect(states[i]).toEqual(originals[i]);
              expect(independentYesProbabilityBps(states[i])).toBe(prices[i]);
              expect(quoteIndependentTrade(states[i], true, true, 100n)).toBe(quotes[i]);
            }
        },
      ),
      { numRuns: 80 },
    );
  }, 30_000);

  it("agrees with exhaustive tiny-state search, including cancellation points", () => {
    for (const initialYesBps of [1, 4000, 5000, 6000, 9999])
      for (const collateral of [2n, 3n, 7n, 13n])
        for (const yes of [true, false])
          for (const buy of [true, false]) {
            const state = pool({
              collateral,
              yes: collateral / 2n,
              no: collateral / 3n,
              initialYesBps,
            });
            const input = buy ? 3n : yes ? state.yes : state.no;
            let maximum = 0n;
            for (let output = 1n; output <= collateral + input; output++) {
              const candidate = independentTradeState(
                state,
                yes,
                buy,
                buy ? input : output,
                buy ? output : input,
              );
              if (input > 0n && weightedProductAccepts(state, candidate)) maximum = output;
            }
            expect(quoteIndependentTrade(state, yes, buy, input)).toBe(maximum);
          }
  });

  it("handles reserve and weight extremes without Number conversions or overflow", () => {
    for (const initialYesBps of [1, 9999])
      for (const yes of [true, false]) {
        const state = pool({
          collateral: MAX_COLLATERAL / 2n,
          yes: MAX_COLLATERAL / 3n,
          no: MAX_COLLATERAL / 4n,
          initialYesBps,
        });
        const input = MAX_COLLATERAL / 10n;
        const output = quoteIndependentTrade(state, yes, true, input);
        expect(output).toBeGreaterThan(0n);
        const next = independentTradeState(state, yes, true, input, output);
        expect(weightedProductAccepts(state, next)).toBe(true);
        expect(questionReserves(next).yes).toBeGreaterThan(0n);
        expect(questionReserves(next).no).toBeGreaterThan(0n);
        expect(
          weightedProductAccepts(
            state,
            independentTradeState(state, yes, true, input, output + 1n),
          ),
        ).toBe(false);
      }
  });
});
