import { ONE } from "@/shared/math";
import { fixedAmounts, type IndependentActions, type IndependentSnapshot } from "./models";

export const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
export const MARKET = "0x2222222222222222222222222222222222222222" as const;
export const TOKEN = "0x3333333333333333333333333333333333333333" as const;
export const SOURCE = "0x4444444444444444444444444444444444444444" as const;
export const GAME = "0x5555555555555555555555555555555555555555" as const;
export const VAULT = "0x6666666666666666666666666666666666666666" as const;
export const zero = () => fixedAmounts(Array<bigint>(8).fill(0n));
export function snapshot(): IndependentSnapshot {
  const metrics = {
    gestureCount: 7n,
    ethSpent: ONE,
    cstBurned: 20n * ONE,
    highestCstPaid: 10n * ONE,
    enduranceDuration: 600n,
    chronoDuration: 700n,
    enduranceGesture: 2n,
    chronoGesture: 3n,
    firstGestureTime: 100n,
    lastGestureTime: 200n,
    finalized: false,
  };
  return {
    market: MARKET,
    token: TOKEN,
    source: SOURCE,
    game: GAME,
    vault: VAULT,
    roundId: 1n,
    currentRound: 1n,
    timestamp: 300n,
    open: true,
    finalized: false,
    settled: false,
    funded: true,
    values: 1,
    observedMask: 1,
    observedValues: 1,
    questions: Array.from({ length: 8 }, () => ({
      pool: { collateral: 1000n * ONE, yes: 0n, no: 0n, initialYesBps: 5000 },
      funded: true,
      usedHistory: false,
      escrowRemaining: 0n,
    })),
    poolCustody: 8000n * ONE,
    claimEscrow: 0n,
    pendingCarry: 0n,
    availableCarry: 0n,
    heldContributions: 0n,
    funding: {
      availableCarry: 0n,
      carryUsed: 0n,
      deferredCarry: 0n,
      totalFunding: 0n,
      maxNewAmount: 100_000n * ONE,
      allocations: zero(),
      needsSettlement: false,
      canFund: false,
      unallocated: 0n,
    },
    user: {
      owner: ACCOUNT,
      yes: fixedAmounts([10n * ONE, ...zero().slice(1)]),
      no: zero(),
      balance: 1000n * ONE,
      allowance: 0n,
    },
    local: {
      ethPrice: ONE / 100n,
      cstPrice: 400n * ONE,
      deadline: 1500n,
      current: metrics,
      previous: { ...metrics, gestureCount: 6n },
    },
  };
}
export function noopActions(): IndependentActions {
  const done = async () => true;
  return {
    pending: null,
    message: null,
    approve: done,
    fund: done,
    distribute: done,
    trade: done,
    settle: done,
    claim: done,
    split: done,
    merge: done,
    mergeAll: done,
    transfer: done,
    local: done,
    advance: async () => {},
  };
}
