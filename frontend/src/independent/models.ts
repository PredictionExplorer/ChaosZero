import { formatUnits, parseUnits } from "viem";
import type { Address } from "viem";
import { independentYesProbabilityBps, type BinaryQuestionPool } from "@/shared/independent-math";
import { matchedSets, type PositionAmounts } from "@/shared/positions";
import { answerYes } from "@/shared/questions";
import type { CycleStats } from "@/shared/use-shared-market";

export interface IndependentQuestion {
  pool: BinaryQuestionPool;
  funded: boolean;
  usedHistory: boolean;
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
  funding: FundingPreview | null;
  user: IndependentWallet | null;
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

/** Funding can intentionally use zero new CST when carried funds are available. */
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
  fund(amount: bigint): Promise<boolean>;
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
  local(kind: "faucet" | "eth" | "cst" | "close"): Promise<boolean>;
  advance(seconds: number): Promise<void>;
}

export interface FundingPreview {
  availableCarry: bigint;
  carryUsed: bigint;
  deferredCarry: bigint;
  totalFunding: bigint;
  maxNewAmount: bigint;
  allocations: PositionAmounts;
  needsSettlement: boolean;
  canFund: boolean;
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
