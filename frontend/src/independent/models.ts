import { formatUnits, parseUnits } from "viem";
import type { Address } from "viem";
import { independentYesProbabilityBps, type BinaryQuestionPool } from "@/shared/independent-math";
import { matchedSets, type PositionAmounts } from "@/shared/positions";
import { answerYes } from "@/shared/questions";
import type { CycleStats } from "@/shared/question-metrics";

export interface IndependentQuestion {
  pool: BinaryQuestionPool;
  funded: boolean;
  escrowRemaining: bigint;
}
export interface IndependentWallet {
  owner: Address;
  yes: PositionAmounts;
  no: PositionAmounts;
  balance: bigint;
  allowance: bigint;
}
export interface IndependentSnapshot {
  market: Address;
  token: Address;
  source: Address;
  game: Address;
  vault: Address;
  roundId: bigint;
  currentRound: bigint;
  timestamp: bigint;
  open: boolean;
  finalized: boolean;
  settled: boolean;
  funded: boolean;
  values: number;
  observedMask: number;
  observedValues: number;
  questions: readonly IndependentQuestion[];
  poolCustody: bigint;
  claimEscrow: bigint;
  pendingCarry: bigint;
  availableCarry: bigint;
  /** CST the market holds beyond its pools and carry: direct transfers and mints. */
  heldContributions: bigint;
  /** `fundingPreview(roundId, 0)`: exactly what the next buy, sell or Distribute absorbs. */
  funding: FundingPreview | null;
  user: IndependentWallet | null;
  metrics?: { current: CycleStats | null; previous: CycleStats | null };
  local: {
    ethPrice: bigint;
    cstPrice: bigint;
    deadline: bigint;
    current: CycleStats;
    previous: CycleStats | null;
  } | null;
}

export function fixedAmounts(values: readonly bigint[]): PositionAmounts {
  if (values.length !== 8 || values.some((value) => value < 0n))
    throw new Error("Invalid position amounts");
  return [values[0], values[1], values[2], values[3], values[4], values[5], values[6], values[7]];
}

/** Settlement decisions, not rounded displayed prices, determine claimability. */
export function winningClaims(
  user: IndependentWallet | null,
  finalized: boolean,
  values: number,
): bigint {
  if (!user || !finalized) return 0n;
  return user.yes.reduce(
    (total, yes, question) => total + (answerYes(values, question) ? yes : user.no[question]),
    0n,
  );
}

export function independentPortfolioValue(
  snapshot: Pick<IndependentSnapshot, "questions" | "finalized" | "values" | "user">,
) {
  if (!snapshot.user) return { indicative: null, matched: 0n, claimable: 0n };
  const { yes, no } = snapshot.user;
  const matched = matchedSets(yes, no);
  let value = 0n;
  let allPricesAvailable = true;
  for (let i = 0; i < 8; i++) {
    if (snapshot.finalized) {
      value += answerYes(snapshot.values, i) ? yes[i] : no[i];
      continue;
    }
    value += matched[i];
    if (yes[i] === matched[i] && no[i] === matched[i]) continue;
    const probability = independentYesProbabilityBps(snapshot.questions[i].pool);
    if (probability === null) {
      allPricesAvailable = false;
      continue;
    }
    value +=
      ((yes[i] - matched[i]) * probability + (no[i] - matched[i]) * (10_000n - probability)) /
      10_000n;
  }
  return {
    indicative: allPricesAvailable ? value : null,
    matched: matched.reduce((sum, amount) => sum + amount, 0n),
    claimable: winningClaims(snapshot.user, snapshot.finalized, snapshot.values),
  };
}

/** No settled claim escrow is counted as liquidity in a new active question. */
export function questionExposure(
  question: IndependentQuestion,
  settled: boolean,
  finalized: boolean,
  yesWon: boolean,
) {
  if (settled) return { collateral: 0n, obligation: question.escrowRemaining, reserve: 0n };
  const { pool } = question;
  const obligation = finalized
    ? yesWon
      ? pool.yes
      : pool.no
    : pool.yes > pool.no
      ? pool.yes
      : pool.no;
  const reserve = pool.collateral - obligation;
  return { collateral: pool.collateral, obligation, reserve };
}

/**
 * Mirrors `MIN_AUTO_TOP_UP` in src/IndependentOutcomeMarket.sol: the smallest held
 * contribution that a trade or a bare Distribute moves into an already-trading
 * cycle. Pinned to the Solidity-generated vectors fixture by a test. It only
 * explains a disabled trigger; the on-chain preview decides what is absorbed.
 */
export const MIN_AUTO_TOP_UP = 10n ** 18n;

/** Same saturating rule as the market: an unsupported external burn reads as zero held. */
export function heldContributions(
  marketBalance: bigint,
  poolCustody: bigint,
  pendingCarry: bigint,
): bigint {
  const accounted = poolCustody + pendingCarry;
  return marketBalance > accounted ? marketBalance - accounted : 0n;
}

/**
 * The absorption the next buy or sell performs before pricing, or null when it
 * places nothing. Only an open, unfinalized cycle whose zero-amount preview can
 * fund absorbs; everything else trades (or fails) against unchanged pools.
 */
export function nextAbsorption(
  snapshot: Pick<IndependentSnapshot, "open" | "finalized" | "funding">,
): FundingPreview | null {
  return snapshot.open && !snapshot.finalized && snapshot.funding?.canFund
    ? snapshot.funding
    : null;
}

/**
 * Pools a trade actually executes against: on-chain state plus the per-pool
 * additions of the next absorption. Seeds of an unstarted cycle already come
 * from `seedPreview`, which is what its first funding initializes.
 */
export function effectiveQuestions(
  snapshot: Pick<IndependentSnapshot, "open" | "finalized" | "funding" | "questions">,
): readonly IndependentQuestion[] {
  const absorption = nextAbsorption(snapshot);
  if (!absorption) return snapshot.questions;
  return snapshot.questions.map((question, i) => ({
    ...question,
    funded: true,
    pool: { ...question.pool, collateral: question.pool.collateral + absorption.allocations[i] },
  }));
}

export interface TradeAccess {
  /** A buy or sell can execute now (possibly after absorbing). */
  tradeable: boolean;
  /** The next trade starts this cycle's pools. */
  opensPools: boolean;
  /** The next trade first settles the preceding funded cycle. */
  settlesPrevious: boolean;
  /** CST the next trade places across all eight pools before pricing. */
  absorbed: bigint;
}

export function tradeAccess(
  snapshot: Pick<IndependentSnapshot, "open" | "finalized" | "funded" | "funding">,
): TradeAccess {
  const absorption = nextAbsorption(snapshot);
  const live = snapshot.open && !snapshot.finalized;
  return {
    tradeable: live && (snapshot.funded || !!absorption),
    opensPools: !snapshot.funded && !!absorption,
    settlesPrevious: !snapshot.funded && !!absorption?.needsSettlement,
    absorbed: absorption?.totalFunding ?? 0n,
  };
}

/**
 * Splits a preview's placement the way the RoundFunded event does:
 * carry + the caller's own gift + held unsolicited CST == totalFunding.
 * The gift is clamped only after an unsupported external burn.
 */
export function fundingBreakdown(preview: FundingPreview, newAmount: bigint) {
  const afterCarry =
    preview.totalFunding > preview.carryUsed ? preview.totalFunding - preview.carryUsed : 0n;
  const donated = newAmount < afterCarry ? newAmount : afterCarry;
  return { carry: preview.totalFunding - afterCarry, donated, held: afterCarry - donated };
}

/** Parses a gift amount. Zero is valid input; the gift button still requires a positive amount. */
export function parseFundingAmount(input: string): { value: bigint | null; error: string | null } {
  const clean = input.trim().replaceAll(",", "");
  if (clean === "") return { value: 0n, error: null };
  if (!/^\d*\.?\d*$/.test(clean) || clean === ".")
    return { value: null, error: "Enter a valid CST amount." };
  const fraction = clean.split(".")[1] ?? "";
  if (fraction.length > 18) return { value: null, error: "Use at most 18 decimal places." };
  return { value: parseUnits(clean, 18), error: null };
}

export const exactCst = (value: bigint) => formatUnits(value, 18);

export interface IndependentActions {
  pending: string | null;
  message: string | null;
  approve(amount: bigint): Promise<boolean>;
  /** Explicit gift: pulls `amount` (> 0) and sweeps every held contribution with it. */
  fund(amount: bigint): Promise<boolean>;
  /** Permissionless `fundRound(round, 0)`: opens pools or distributes held CST now. */
  distribute(): Promise<boolean>;
  trade(
    question: number,
    yes: boolean,
    buy: boolean,
    input: bigint,
    output: bigint,
  ): Promise<boolean>;
  settle(): Promise<boolean>;
  claim(): Promise<boolean>;
  split(question: number, amount: bigint): Promise<boolean>;
  merge(question: number, amount: bigint): Promise<boolean>;
  mergeAll(amounts: PositionAmounts): Promise<boolean>;
  transfer(question: number, yes: boolean, amount: bigint, recipient: string): Promise<boolean>;
  local(kind: LocalControl): Promise<boolean>;
  advance(seconds: number): Promise<void>;
}

export type LocalControl = "faucet" | "eth" | "cst" | "close" | "direct";

/** Amount the local "direct transfer" control sends straight to the market. */
export const LOCAL_DIRECT_TRANSFER = 100n * 10n ** 18n;

export interface FundingPreview {
  availableCarry: bigint;
  carryUsed: bigint;
  deferredCarry: bigint;
  totalFunding: bigint;
  maxNewAmount: bigint;
  allocations: PositionAmounts;
  needsSettlement: boolean;
  canFund: boolean;
  /** Held unsolicited CST at the preview's block. */
  unallocated: bigint;
}

export interface IndependentRecovery {
  market: Address;
  token: Address;
  vault: Address;
  roundId: bigint;
  timestamp: bigint;
  settled: boolean;
  values: number;
  questions: readonly IndependentQuestion[];
  user: IndependentWallet;
}
