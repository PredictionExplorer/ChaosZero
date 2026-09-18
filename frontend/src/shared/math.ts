import { answerYes, questionKnown } from "./questions";

export const ONE = 10n ** 18n;
export const MAX_COLLATERAL = 1n << 120n;
export const MIN_FUNDING = 10n ** 12n;
const Q = 1n << 127n;
const TWO_Q = 1n << 128n;
const MASK = Q - 1n;

export interface SharedPool {
  collateral: bigint;
  yes: readonly bigint[];
  no: readonly bigint[];
  knownMask: number;
  values: number;
}

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

export function feasibleReserves(pool: SharedPool): { ending: number; reserve: bigint }[] {
  if (
    pool.yes.length !== 8 ||
    pool.no.length !== 8 ||
    pool.collateral < 0n ||
    pool.collateral > MAX_COLLATERAL ||
    pool.knownMask < 0 ||
    pool.knownMask > 255 ||
    (pool.values & ~pool.knownMask) !== 0
  )
    throw new Error("Invalid pool state");
  const rows = [];
  for (let ending = 0; ending < 256; ending++) {
    if ((ending & pool.knownMask) !== pool.values) continue;
    let debt = 0n;
    for (let i = 0; i < 8; i++) {
      if (pool.yes[i] < 0n || pool.no[i] < 0n) throw new Error("Negative liability");
      debt += answerYes(ending, i) ? pool.yes[i] : pool.no[i];
    }
    rows.push({ ending, reserve: pool.collateral - debt });
  }
  return rows;
}

/** Matches _verify, including cancellation of unchanged reserves before applying bounds. */
export function productAccepts(before: SharedPool, after: SharedPool): boolean {
  try {
    const previous = feasibleReserves(before);
    const next = feasibleReserves(after);
    if (before.knownMask !== after.knownMask || before.values !== after.values) return false;
    const cache = new Map<bigint, readonly [bigint, bigint]>();
    const bounds = (x: bigint) => {
      let result = cache.get(x);
      if (!result) {
        result = log2Bounds(x);
        cache.set(x, result);
      }
      return result;
    };
    let oldUpper = 0n;
    let newLower = 0n;
    for (let i = 0; i < previous.length; i++) {
      const old = previous[i].reserve;
      const current = next[i].reserve;
      if (current <= 0n || old <= 0n) return false;
      if (current === old) continue;
      oldUpper += bounds(old)[1];
      newLower += bounds(current)[0];
    }
    return newLower >= oldUpper;
  } catch {
    return false;
  }
}

export function tradeState(
  pool: SharedPool,
  question: number,
  yes: boolean,
  buy: boolean,
  cash: bigint,
  units: bigint,
): SharedPool {
  const nextYes = [...pool.yes];
  const nextNo = [...pool.no];
  const selected = yes ? nextYes : nextNo;
  selected[question] += buy ? units : -units;
  return { ...pool, collateral: pool.collateral + (buy ? cash : -cash), yes: nextYes, no: nextNo };
}

/** Exact proposed amounts: the contract checks these values, not minimum-output arguments. */
export function quoteTrade(
  pool: SharedPool,
  question: number,
  yes: boolean,
  buy: boolean,
  amount: bigint,
): bigint {
  if (
    !Number.isInteger(question) ||
    question < 0 ||
    question >= 8 ||
    questionKnown(pool.knownMask, question) ||
    amount <= 0n ||
    amount > MAX_COLLATERAL
  )
    return 0n;
  if (buy && pool.collateral + amount > MAX_COLLATERAL) return 0n;
  if (!buy && amount > (yes ? pool.yes[question] : pool.no[question])) return 0n;
  let upper: bigint;
  const afterInput = tradeState(pool, question, yes, buy, buy ? amount : 0n, buy ? 0n : amount);
  const reserves = feasibleReserves(afterInput);
  const eligible = buy
    ? reserves.filter((row) => answerYes(row.ending, question) === yes)
    : reserves;
  if (eligible.some((row) => row.reserve <= 0n)) return 0n;
  upper = eligible.reduce((a, row) => (row.reserve < a ? row.reserve : a), MAX_COLLATERAL) - 1n;
  if (!buy && upper >= pool.collateral) upper = pool.collateral - 1n;
  // Old bounds are independent of the candidate output. Group identical reserves
  // (common before every question has traded), and cache them throughout search.
  const groups = new Map<
    string,
    { reserve: bigint; selected: boolean; count: bigint; upper: bigint }
  >();
  for (const row of feasibleReserves(pool)) {
    if (row.reserve <= 0n) return 0n;
    const selected = answerYes(row.ending, question) === yes;
    const key = `${row.reserve}:${selected}`;
    const group = groups.get(key);
    if (group) group.count++;
    else
      groups.set(key, {
        reserve: row.reserve,
        selected,
        count: 1n,
        upper: log2Bounds(row.reserve)[1],
      });
  }
  const accepts = (output: bigint) => {
    let oldUpper = 0n;
    let newLower = 0n;
    const bounds = new Map<bigint, bigint>();
    for (const group of groups.values()) {
      const reserve =
        group.reserve + (buy ? amount : -output) + (group.selected ? (buy ? -output : amount) : 0n);
      if (reserve <= 0n || reserve > MAX_COLLATERAL) return false;
      if (reserve === group.reserve) continue;
      let bound = bounds.get(reserve);
      if (bound === undefined) {
        bound = log2Bounds(reserve)[0];
        bounds.set(reserve, bound);
      }
      oldUpper += group.upper * group.count;
      newLower += bound * group.count;
    }
    return newLower >= oldUpper;
  };
  const maximum = upper;
  let lower = 0n;
  while (lower < upper) {
    const middle = (lower + upper + 1n) / 2n;
    if (accepts(middle)) lower = middle;
    else upper = middle - 1n;
  }
  // At output == input, half of the reserves may be exactly unchanged. The
  // contract cancels those factors, which can admit a tiny isolated quote that
  // a monotone binary search misses. Check that point explicitly.
  if (amount > lower && amount <= maximum && accepts(amount)) return amount;
  return lower;
}

/** Marginal YES price, in basis points; exact-integer reciprocals avoid Number overflow. */
export function yesProbabilityBps(pool: SharedPool, question: number): bigint | null {
  if (questionKnown(pool.knownMask, question))
    return answerYes(pool.values, question) ? 10_000n : 0n;
  if (pool.collateral === 0n) return null;
  let all = 0n;
  let yes = 0n;
  for (const row of feasibleReserves(pool)) {
    if (row.reserve <= 0n) return null;
    const weight = (1n << 240n) / row.reserve;
    all += weight;
    if (answerYes(row.ending, question)) yes += weight;
  }
  return all === 0n ? null : (yes * 10_000n) / all;
}

export function claimable(
  yes: readonly bigint[],
  no: readonly bigint[],
  knownMask: number,
  values: number,
): bigint {
  return yes.reduce(
    (sum, value, i) =>
      sum + (questionKnown(knownMask, i) ? (answerYes(values, i) ? value : no[i]) : 0n),
    0n,
  );
}
