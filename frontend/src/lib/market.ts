import type { Address } from "viem";
import type { PoolState } from "./math";
import {
  claimValue,
  currentFeeBps,
  poolIsTradable,
  positionValueAtProbability,
  probabilityFloat,
} from "./math";

/**
 * Lifecycle of one round's market:
 *  - `uninitialized` — nobody has added liquidity for this round yet.
 *  - `future`        — the market exists but the game hasn't reached the
 *                      round: betting and liquidity are open, the threshold
 *                      is not locked yet, and nothing can be decided or
 *                      resolved before the round starts.
 *  - `live`          — the game's current round: betting, liquidity and sets
 *                      are open against the locked threshold.
 *  - `decided`       — the gesture count crossed the threshold mid-round:
 *                      YES already won; betting/adds halted; resolve is open.
 *  - `ended`         — the round finished but nobody called `resolve` yet.
 *  - `resolved`      — the winner is fixed; claiming is open.
 */
export type RoundPhase = "uninitialized" | "future" | "live" | "decided" | "ended" | "resolved";

/** Everything the UI needs about one round of the series, in one multicall. */
export interface RoundSnapshot {
  readonly seriesAddress: Address;
  readonly roundId: bigint;
  readonly initialized: boolean;
  /**
   * Whether the threshold is knowable yet: locked in the contract, or final
   * in the game and reported live by `roundState`. False while the round is
   * still in the future (the previous round hasn't finished).
   */
  readonly thresholdKnown: boolean;
  readonly resolved: boolean;
  readonly yesWon: boolean;
  /**
   * The previous round's final gesture count — the number to beat. Reported
   * by the contract for every knowable phase; 0 (meaningless) while
   * `thresholdKnown` is false.
   */
  readonly threshold: bigint;
  /** This round's gesture count so far (final once the round ends). */
  readonly currentCount: bigint;
  /** The game's current round counter. */
  readonly gameRoundNum: bigint;
  /**
   * The previous round's gesture count so far — the FORMING threshold of a
   * future round (equals `threshold` once it locks). Only meaningful for
   * `roundId === gameRoundNum + 1`; earlier rounds haven't started.
   */
  readonly prevRoundCount: bigint;
  /** The round's single pool. */
  readonly pool: PoolState;
  readonly cstAddress: Address;
  readonly gameAddress: Address;
}

/** The raw `roundState(roundId)` tuple, in ABI output order. */
export type RoundStateTuple = readonly [
  initialized: boolean,
  thresholdKnown: boolean,
  resolved: boolean,
  yesWon: boolean,
  threshold: bigint,
  currentCount: bigint,
  roundActive: boolean,
  outcomeDecided: boolean,
];

/** The raw `pool(roundId)` tuple, in ABI output order. */
export type PoolTuple = readonly [
  reserveYes: bigint,
  reserveNo: bigint,
  totalShares: bigint,
  accFeePerShare: bigint,
  feeReserve: bigint,
  feeWeight: bigint,
  feeBps: bigint,
];

/**
 * Pure mapping from the raw multicall tuples to a `RoundSnapshot` — the one
 * place ABI output order is interpreted, unit- and fuzz-tested directly.
 */
export function toRoundSnapshot(args: {
  seriesAddress: Address;
  roundId: bigint;
  state: RoundStateTuple;
  pool: PoolTuple;
  gameRoundNum: bigint;
  prevRoundCount: bigint;
  cstAddress: Address;
  gameAddress: Address;
}): RoundSnapshot {
  const [initialized, thresholdKnown, resolved, yesWon, threshold, currentCount] = args.state;
  return {
    seriesAddress: args.seriesAddress,
    roundId: args.roundId,
    initialized,
    thresholdKnown,
    resolved,
    yesWon,
    threshold,
    currentCount,
    gameRoundNum: args.gameRoundNum,
    prevRoundCount: args.prevRoundCount,
    pool: {
      reserveYes: args.pool[0],
      reserveNo: args.pool[1],
      totalShares: args.pool[2],
      accFeePerShare: args.pool[3],
      feeReserve: args.pool[4],
      feeWeight: args.pool[5],
    },
    cstAddress: args.cstAddress,
    gameAddress: args.gameAddress,
  };
}

/** The connected user's stake in one round. */
export interface UserSnapshot {
  readonly address: Address;
  readonly yesBalance: bigint;
  readonly noBalance: bigint;
  readonly cstBalance: bigint;
  readonly cstAllowance: bigint;
  /** LP position: shares, claimable fees, and the user's fee vote. */
  readonly lpShares: bigint;
  readonly lpPendingFees: bigint;
  readonly lpDeclaredFeeBps: number;
}

type PhaseInputs = Pick<
  RoundSnapshot,
  | "initialized"
  | "thresholdKnown"
  | "resolved"
  | "roundId"
  | "gameRoundNum"
  | "currentCount"
  | "threshold"
>;

export function roundPhase(s: PhaseInputs): RoundPhase {
  if (s.resolved) return "resolved";
  if (!s.initialized) return "uninitialized";
  if (s.roundId > s.gameRoundNum) return "future";
  if (s.gameRoundNum > s.roundId) return "ended";
  if (s.thresholdKnown && s.currentCount > s.threshold) return "decided";
  return "live";
}

/** Whether betting is currently possible (current round or any future round). */
export function isTradable(s: RoundSnapshot): boolean {
  const phase = roundPhase(s);
  return (phase === "live" || phase === "future") && poolIsTradable(s.pool);
}

/**
 * Whether `addLiquidity` would succeed: the round is live or future (adds
 * join the pool), or still uninitialized but open-able — current or future,
 * with a previous round, and with the outcome still uncertain. Past rounds
 * are withdraw-only forever.
 */
export function canAddLiquidity(s: PhaseInputs): boolean {
  const phase = roundPhase(s);
  if (phase === "live" || phase === "future") return true;
  return (
    phase === "uninitialized" &&
    s.roundId >= 1n &&
    s.roundId >= s.gameRoundNum &&
    !(s.thresholdKnown && s.currentCount > s.threshold)
  );
}

/** Whether `resolve()` would succeed right now. */
export function isResolvable(s: PhaseInputs): boolean {
  const phase = roundPhase(s);
  return phase === "ended" || phase === "decided";
}

/**
 * Whether `mintSets` would succeed: the market exists, the round isn't over
 * or resolved. Minting stays open on decided rounds (a set is value-neutral:
 * it always redeems or claims for exactly 1 CST).
 */
export function canMintSets(s: PhaseInputs): boolean {
  const phase = roundPhase(s);
  return phase === "future" || phase === "live" || phase === "decided";
}

/** Whether `claim` pays out (rather than reverting): the round is resolved. */
export function canClaim(s: PhaseInputs): boolean {
  return roundPhase(s) === "resolved";
}

/** Total outcome tokens in the pool (a liquidity gauge). */
export function totalLiquidity(pool: PoolState): bigint {
  return pool.reserveYes + pool.reserveNo;
}

/** The pool's live weighted-average fee, in bps (number, for display). */
export function poolFeeBps(pool: PoolState): number {
  return Number(currentFeeBps(pool));
}

/**
 * The headline probability the UI shows for YES ("this round beats the last
 * one"), in [0,1]:
 *  - resolved: exactly 0 or 1;
 *  - decided: 1 (the count already crossed);
 *  - otherwise: the pool-implied probability, or null when unfunded.
 */
export function displayedProbability(s: RoundSnapshot): number | null {
  const phase = roundPhase(s);
  if (phase === "resolved") return s.yesWon ? 1 : 0;
  if (phase === "decided") return 1;
  return probabilityFloat(s.pool);
}

/**
 * What the user's outcome tokens are worth in CST:
 *  - resolved: the exact claim value;
 *  - decided: YES is certain (its tokens are worth 1, NO worth 0);
 *  - live/ended: marked at the displayed probability (float, display-only).
 */
export function positionValueFloat(
  s: RoundSnapshot,
  user: Pick<UserSnapshot, "yesBalance" | "noBalance">,
): number {
  const phase = roundPhase(s);
  if (phase === "resolved")
    return Number(claimValue(user.yesBalance, user.noBalance, s.yesWon)) / 1e18;
  if (phase === "decided") return Number(user.yesBalance) / 1e18;
  const p = displayedProbability(s);
  return positionValueAtProbability(user.yesBalance, user.noBalance, p ?? 0.5);
}

export function hasPosition(user: Pick<UserSnapshot, "yesBalance" | "noBalance">): boolean {
  return user.yesBalance > 0n || user.noBalance > 0n;
}

export function hasLpPosition(user: Pick<UserSnapshot, "lpShares" | "lpPendingFees">): boolean {
  return user.lpShares > 0n || user.lpPendingFees > 0n;
}

/** How far the current count is toward the threshold, in [0,1] (can exceed). */
export function thresholdProgress(s: Pick<RoundSnapshot, "currentCount" | "threshold">): number {
  if (s.threshold === 0n) return s.currentCount > 0n ? 1 : 0;
  return Number(s.currentCount) / Number(s.threshold);
}
