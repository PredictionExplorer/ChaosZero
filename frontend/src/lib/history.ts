import type { BetSide, PoolState } from "./math";
import { applyBetWithNet, DEAD_SHARES, EMPTY_POOL, probabilityFloat } from "./math";

/**
 * Event-sourced replay of one round's pool. The contract's events carry the
 * exact reserve deltas (deposits, net swap amounts, withdrawals), so the full
 * pool state at any point in history is reconstructible from logs alone — no
 * archive node, no backward unwinding. Crucially, `Bet` events carry `netIn`,
 * so replay never needs to know what the (time-varying, vote-driven) fee was
 * at the moment of the bet.
 */

/** A Bet event, decoded. Ordering fields sort exactly as the chain did. */
export interface BetEvent {
  readonly kind: "bet";
  readonly blockNumber: bigint;
  readonly logIndex: number;
  readonly transactionHash: `0x${string}`;
  readonly user: `0x${string}`;
  readonly side: BetSide;
  readonly cstIn: bigint;
  readonly netIn: bigint;
  readonly tokensOut: bigint;
  readonly timestamp: number | null;
}

/** A LiquidityAdded event: `yesToPool`/`noToPool` are the exact deposits. */
export interface LiquidityAddedEvent {
  readonly kind: "add";
  readonly blockNumber: bigint;
  readonly logIndex: number;
  readonly transactionHash: `0x${string}`;
  readonly provider: `0x${string}`;
  readonly cstIn: bigint;
  readonly declaredFeeBps: number;
  readonly sharesOut: bigint;
  readonly yesToPool: bigint;
  readonly noToPool: bigint;
  readonly timestamp: number | null;
}

/** A LiquidityRemoved event: exact withdrawals. */
export interface LiquidityRemovedEvent {
  readonly kind: "remove";
  readonly blockNumber: bigint;
  readonly logIndex: number;
  readonly transactionHash: `0x${string}`;
  readonly provider: `0x${string}`;
  readonly sharesIn: bigint;
  readonly yesOut: bigint;
  readonly noOut: bigint;
  readonly feesOut: bigint;
  readonly timestamp: number | null;
}

export type PoolEvent = BetEvent | LiquidityAddedEvent | LiquidityRemovedEvent;

export interface ProbabilityPoint {
  /** P(YES) after this event, in [0,1]. */
  readonly probability: number;
  readonly blockNumber: bigint;
  readonly logIndex: number;
  readonly timestamp: number | null;
}

/** Chain order: by block, then by log index within the block. */
export function sortEvents<T extends { blockNumber: bigint; logIndex: number }>(
  events: readonly T[],
): T[] {
  return [...events].sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
    return a.logIndex - b.logIndex;
  });
}

/**
 * Applies one event to the pool, mirroring the contract exactly.
 *
 * Note on `feeWeight`: the events don't carry the removed voter's declaration,
 * so replay tracks reserves and shares exactly and leaves the vote ledger out
 * (the UI reads the live fee from the chain, not from history). The fee escrow
 * is approximate: `FeesClaimed` is not replayed, and a top-up that pays out
 * pending fees emits only `LiquidityAdded`; the UI reads `feeReserve` from the
 * chain too.
 */
export function applyPoolEvent(pool: PoolState, event: PoolEvent): PoolState {
  switch (event.kind) {
    case "add": {
      const opening = pool.totalShares === 0n;
      return {
        ...pool,
        reserveYes: pool.reserveYes + event.yesToPool,
        reserveNo: pool.reserveNo + event.noToPool,
        // The contract locks DEAD_SHARES on top of the first LP's shares.
        totalShares: pool.totalShares + event.sharesOut + (opening ? DEAD_SHARES : 0n),
      };
    }
    case "remove":
      return {
        ...pool,
        reserveYes: pool.reserveYes - event.yesOut,
        reserveNo: pool.reserveNo - event.noOut,
        totalShares: pool.totalShares - event.sharesIn,
        feeReserve: pool.feeReserve - event.feesOut,
      };
    case "bet": {
      // The event's netIn pins the historical fee exactly.
      const fee = event.cstIn - event.netIn;
      return applyBetWithNet(event.side, pool, fee, event.netIn).pool;
    }
  }
}

export interface ReplayResult {
  /** P(YES) after every event. */
  readonly points: ProbabilityPoint[];
  /** Final pool state implied by the events. */
  readonly pool: PoolState;
}

/**
 * Replays all of one round's pool events forward, producing the probability
 * chart and the final pool state. The reconstruction is exact for reserves
 * and shares: they must equal the current on-chain pool (asserted here and by
 * the contract suite's testFuzz_poolEventsReplayToTheExactPool).
 */
export function replayRound(events: readonly PoolEvent[]): ReplayResult {
  let pool = EMPTY_POOL;
  const points: ProbabilityPoint[] = [];

  for (const event of sortEvents(events)) {
    pool = applyPoolEvent(pool, event);
    const probability = probabilityFloat(pool);
    if (probability !== null) {
      points.push({
        probability,
        blockNumber: event.blockNumber,
        logIndex: event.logIndex,
        timestamp: event.timestamp,
      });
    }
  }

  return { points, pool };
}
