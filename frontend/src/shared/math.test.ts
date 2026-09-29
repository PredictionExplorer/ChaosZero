import { describe, expect, it } from "vitest";
import { log2Bounds, MAX_COLLATERAL } from "./math";

describe("log2Bounds", () => {
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
});
