import { log2Bounds, MAX_COLLATERAL } from "./math";

const BPS = 10_000n;

/** One question's custody and outstanding claims; no other question enters its price. */
export interface BinaryQuestionPool {
  collateral: bigint;
  yes: bigint;
  no: bigint;
  /** Fixed weight for this cycle, not the current marginal probability. */
  initialYesBps: number;
}

export interface QuestionReserves {
  yes: bigint;
  no: bigint;
}

/** Zero reserves can describe an unfunded or split-only question, but cannot trade. */
export function questionReserves(pool: BinaryQuestionPool): QuestionReserves {
  if (
    !Number.isInteger(pool.initialYesBps) ||
    pool.initialYesBps < 1 ||
    pool.initialYesBps >= 10_000 ||
    pool.collateral < 0n ||
    pool.collateral > MAX_COLLATERAL ||
    pool.yes < 0n ||
    pool.no < 0n ||
    pool.yes > MAX_COLLATERAL ||
    pool.no > MAX_COLLATERAL
  )
    throw new Error("Invalid independent question state");
  return { yes: pool.collateral - pool.yes, no: pool.collateral - pool.no };
}

/**
 * Shared acceptance kernel. Pool validation already bounds each nonnegative
 * liability and collateral by MAX_COLLATERAL, so a positive reserve is also
 * within the logarithm's domain. The quote solver supplies cached old bounds.
 */
function reservesAccept(
  before: QuestionReserves,
  after: QuestionReserves,
  yesWeight: bigint,
  upperBounds?: QuestionReserves,
): boolean {
  if (before.yes <= 0n || before.no <= 0n || after.yes <= 0n || after.no <= 0n) return false;
  let previousUpper = 0n;
  let nextLower = 0n;
  for (const [previous, current, weight, cachedUpper] of [
    [before.yes, after.yes, yesWeight, upperBounds?.yes],
    [before.no, after.no, BPS - yesWeight, upperBounds?.no],
  ] as const) {
    if (previous === current) continue;
    previousUpper += weight * (cachedUpper ?? log2Bounds(previous)[1]);
    nextLower += weight * log2Bounds(current)[0];
  }
  return nextLower >= previousUpper;
}

/**
 * Rigorous acceptance for Ryes^p * Rno^(10000-p). Multiplying directed
 * logarithm bounds by positive integer weights preserves their enclosure.
 * Exactly unchanged factors cancel before the bounds are summed.
 */
export function weightedProductAccepts(
  before: BinaryQuestionPool,
  after: BinaryQuestionPool,
): boolean {
  try {
    const old = questionReserves(before);
    const next = questionReserves(after);
    if (before.initialYesBps !== after.initialYesBps) return false;
    return reservesAccept(old, next, BigInt(before.initialYesBps));
  } catch {
    return false;
  }
}

/** Pure candidate state; weightedProductAccepts is the validation boundary. */
export function independentTradeState(
  pool: BinaryQuestionPool,
  yes: boolean,
  buy: boolean,
  cash: bigint,
  units: bigint,
): BinaryQuestionPool {
  return {
    ...pool,
    collateral: pool.collateral + (buy ? cash : -cash),
    yes: pool.yes + (yes ? (buy ? units : -units) : 0n),
    no: pool.no + (!yes ? (buy ? units : -units) : 0n),
  };
}

/**
 * Maximum conservatively executable output for fixed input: units for a buy,
 * CST for a sell. Zero means no executable positive quote. Source/phase and
 * wallet balances are checked separately; this function knows only this pool.
 */
export function quoteIndependentTrade(
  pool: BinaryQuestionPool,
  yes: boolean,
  buy: boolean,
  input: bigint,
): bigint {
  let old: QuestionReserves;
  try {
    old = questionReserves(pool);
  } catch {
    return 0n;
  }
  if (old.yes <= 0n || old.no <= 0n || input <= 0n || input > MAX_COLLATERAL) return 0n;
  if (buy && pool.collateral + input > MAX_COLLATERAL) return 0n;
  if (!buy && input > (yes ? pool.yes : pool.no)) return 0n;

  const selectedReserve = yes ? old.yes : old.no;
  const otherReserve = yes ? old.no : old.yes;
  const maximum = buy
    ? selectedReserve + input - 1n
    : (selectedReserve + input < otherReserve ? selectedReserve + input : otherReserve) - 1n;
  if (maximum <= 0n) return 0n;
  const yesWeight = BigInt(pool.initialYesBps);
  const upperBounds = { yes: log2Bounds(old.yes)[1], no: log2Bounds(old.no)[1] };
  const accepts = (output: bigint) => {
    const selected = selectedReserve + input - output;
    const other = otherReserve + (buy ? input : -output);
    const next = yes ? { yes: selected, no: other } : { yes: other, no: selected };
    return reservesAccept(old, next, yesWeight, upperBounds);
  };

  let lower = 0n;
  let upper = maximum;
  while (lower < upper) {
    const middle = (lower + upper + 1n) / 2n;
    if (accepts(middle)) lower = middle;
    else upper = middle - 1n;
  }
  // Removing the interval-width penalty of an unchanged factor can create an
  // isolated accepted dust quote at output == input. Check it explicitly.
  if (input > lower && input <= maximum && accepts(input)) return input;
  return lower;
}

/** Floored marginal YES price in BPS. Null means the reserves cannot support trading. */
export function independentYesProbabilityBps(pool: BinaryQuestionPool): bigint | null {
  let reserves: QuestionReserves;
  try {
    reserves = questionReserves(pool);
  } catch {
    return null;
  }
  if (reserves.yes <= 0n || reserves.no <= 0n) return null;
  const weightedNo = BigInt(pool.initialYesBps) * reserves.no;
  const denominator = weightedNo + (BPS - BigInt(pool.initialYesBps)) * reserves.yes;
  return (weightedNo * BPS) / denominator;
}
