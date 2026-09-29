import type { Address } from "viem";
import type { RoundSnapshot, UserSnapshot } from "@/lib/market";
import { ONE, type PoolState } from "@/lib/math";

/** Distinct, recognizable addresses for the actors in a test. */
export const SERIES: Address = "0x1111111111111111111111111111111111111111";
export const CST: Address = "0x2222222222222222222222222222222222222222";
export const GAME: Address = "0x3333333333333333333333333333333333333333";
export const USER: Address = "0x4444444444444444444444444444444444444444";

/** A funded 50/50 pool whose LPs vote a 2% fee. */
export function pool(overrides: Partial<PoolState> = {}): PoolState {
  return {
    reserveYes: 1_000n * ONE,
    reserveNo: 1_000n * ONE,
    totalShares: 1_000n * ONE,
    accFeePerShare: 0n,
    feeReserve: 0n,
    feeWeight: 1_000n * ONE * 200n,
    ...overrides,
  };
}

/** Round 5, live: the game is on round 5, 500 gestures toward a locked 800. */
export function roundSnapshot(overrides: Partial<RoundSnapshot> = {}): RoundSnapshot {
  return {
    seriesAddress: SERIES,
    roundId: 5n,
    initialized: true,
    thresholdKnown: true,
    resolved: false,
    yesWon: false,
    threshold: 800n,
    currentCount: 500n,
    gameRoundNum: 5n,
    prevRoundCount: 800n,
    pool: pool(),
    cstAddress: CST,
    gameAddress: GAME,
    ...overrides,
  };
}

/** A connected user holding 100 YES / 40 NO and 1,000 CST, nothing approved. */
export function userSnapshot(overrides: Partial<UserSnapshot> = {}): UserSnapshot {
  return {
    address: USER,
    yesBalance: 100n * ONE,
    noBalance: 40n * ONE,
    cstBalance: 1_000n * ONE,
    cstAllowance: 0n,
    lpShares: 0n,
    lpPendingFees: 0n,
    lpDeclaredFeeBps: 0,
    ...overrides,
  };
}
