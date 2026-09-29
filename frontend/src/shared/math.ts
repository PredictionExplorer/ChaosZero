export const ONE = 10n ** 18n;
export const MAX_COLLATERAL = 1n << 120n;
const Q = 1n << 127n;
const TWO_Q = 1n << 128n;
const MASK = Q - 1n;

/** Bit-for-bit port of the contract's enclosing Q64 logarithm, not a floating-point acceptance test. */
export function log2Bounds(x: bigint): readonly [bigint, bigint] {
  if (x <= 0n || x > MAX_COLLATERAL) throw new Error("Reserve outside supported range");
  const exponent = BigInt(x.toString(2).length - 1);
  let lower = exponent << 64n;
  if ((x & (x - 1n)) === 0n) return [lower, lower];
  let lo = x << (127n - exponent);
  let hi = lo;
  let upper = lower;
  for (let bit = 1n << 63n; bit !== 0n; bit >>= 1n) {
    const squareLo = lo * lo;
    const squareHi = hi * hi;
    lo = squareLo >> 127n;
    hi = (squareHi >> 127n) + ((squareHi & MASK) === 0n ? 0n : 1n);
    if (lo >= TWO_Q) {
      lower += bit;
      lo >>= 1n;
    }
    if (hi >= TWO_Q) {
      upper += bit;
      hi = (hi >> 1n) + (hi & 1n);
    }
  }
  if (hi !== Q) upper += 1n;
  return [lower, upper];
}
