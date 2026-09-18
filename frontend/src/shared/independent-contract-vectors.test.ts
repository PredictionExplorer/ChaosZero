import { describe, expect, it } from "vitest";
import vectors from "@/test/fixtures/independent-contract-vectors.json";
import {
  independentYesProbabilityBps,
  weightedProductAccepts,
  type BinaryQuestionPool,
} from "./independent-math";

function state(
  value: { collateral: string; yes: string; no: string },
  initialYesBps: number,
): BinaryQuestionPool {
  return {
    collateral: BigInt(value.collateral),
    yes: BigInt(value.yes),
    no: BigInt(value.no),
    initialYesBps,
  };
}

describe("independent binary Solidity differential vectors", () => {
  it("contains actual accepted/rejected and marginal-revert cases across the required boundaries", () => {
    expect(vectors).toHaveLength(130);
    expect(new Set(vectors.map((vector) => vector.name)).size).toBe(vectors.length);
    for (const p of [1, 4000, 5000, 6000, 9999])
      expect(vectors.some((vector) => vector.initialYesBps === p)).toBe(true);
    expect(vectors.some((vector) => vector.accepted)).toBe(true);
    expect(vectors.some((vector) => !vector.accepted)).toBe(true);
    expect(vectors.some((vector) => vector.beforeMarginalBps === null)).toBe(true);
    expect(vectors.some((vector) => vector.afterMarginalBps === null)).toBe(true);
    for (const suffix of ["buy-yes", "buy-no", "sell-yes", "sell-no"])
      expect(vectors.some((vector) => vector.name.endsWith(suffix))).toBe(true);
  });

  for (const vector of vectors) {
    it(`matches compiled Solidity acceptance and both marginal prices: ${vector.name}`, () => {
      const before = state(vector.before, vector.initialYesBps);
      const after = state(vector.after, vector.initialYesBps);
      expect(weightedProductAccepts(before, after)).toBe(vector.accepted);
      expect(independentYesProbabilityBps(before)).toBe(
        vector.beforeMarginalBps === null ? null : BigInt(vector.beforeMarginalBps),
      );
      expect(independentYesProbabilityBps(after)).toBe(
        vector.afterMarginalBps === null ? null : BigInt(vector.afterMarginalBps),
      );
    });
  }
});
