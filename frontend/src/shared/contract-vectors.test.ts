import { describe, expect, it } from "vitest";
import vectors from "@/test/fixtures/shared-contract-vectors.json";
import { log2Bounds, productAccepts, tradeState, type SharedPool } from "./math";
import { questionKnown } from "./questions";

describe("shared Solidity differential vectors", () => {
  for (const vector of vectors) {
    if (vector.kind === "log") {
      it(`matches Solidity logarithm bounds for ${vector.input}`, () => {
        expect(log2Bounds(BigInt(vector.input!))).toEqual([
          BigInt(vector.lower!),
          BigInt(vector.upper!),
        ]);
      });
    } else {
      it(`matches the real contract acceptance result: ${vector.name}`, () => {
        const state: SharedPool = {
          collateral: BigInt(vector.collateral!),
          yes: vector.yes!.map(BigInt),
          no: vector.no!.map(BigInt),
          knownMask: vector.knownMask!,
          values: vector.values!,
        };
        const next = tradeState(
          state,
          vector.question!,
          vector.yesSide!,
          vector.buy!,
          BigInt(vector.cash!),
          BigInt(vector.units!),
        );
        expect(
          !questionKnown(state.knownMask, vector.question!) && productAccepts(state, next),
        ).toBe(vector.accepted);
      });
    }
  }
});
