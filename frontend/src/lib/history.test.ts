import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { BetEvent, LiquidityAddedEvent, LiquidityRemovedEvent, PoolEvent } from "./history";
import { applyPoolEvent, replayRound, sortEvents } from "./history";
import type { PoolState } from "./math";
import {
  applyBet,
  currentFeeBps,
  DEAD_SHARES,
  EMPTY_POOL,
  joinPool,
  ONE,
  openPool,
  removeLiquidity,
} from "./math";

/**
 * Simulates a contract execution with the math lib while emitting the exact
 * events the contract would, then checks `replayRound` reconstructs the same
 * end state from the events alone. Bets are replayed via their recorded
 * `netIn`, so the roundtrip stays exact even though the fee vote (and thus
 * the fee of every bet) changes throughout the sequence.
 */

interface SimStep {
  readonly action: "join" | "removeHalf" | "betYes" | "betNo" | "revote";
  readonly amount: bigint;
  readonly feeBps: bigint;
}

const HEX = "0xabc" as `0x${string}`;
const USER = "0x1111111111111111111111111111111111111111" as `0x${string}`;

const arbStep: fc.Arbitrary<SimStep> = fc.record({
  action: fc.constantFrom("join", "removeHalf", "betYes", "betNo", "revote") as fc.Arbitrary<
    SimStep["action"]
  >,
  amount: fc.bigInt({ min: 10n ** 6n, max: 10n ** 23n }),
  feeBps: fc.bigInt({ min: 0n, max: 1_000n }),
});

function simulate(
  openAmount: bigint,
  probBps: bigint,
  openFee: bigint,
  steps: readonly SimStep[],
  startLogIndex = 0,
): { events: PoolEvent[]; endPool: PoolState } {
  const events: PoolEvent[] = [];
  let logIndex = startLogIndex;
  let sharesHeld: bigint;
  let declared = openFee;
  const base = () => ({
    blockNumber: 1n,
    logIndex: logIndex++,
    transactionHash: HEX,
    timestamp: null,
  });

  const opened = openPool(openAmount, probBps, openFee);
  let pool = opened.pool;
  sharesHeld = opened.sharesOut;
  events.push({
    kind: "add",
    ...base(),
    provider: USER,
    cstIn: openAmount,
    declaredFeeBps: Number(openFee),
    sharesOut: opened.sharesOut,
    yesToPool: pool.reserveYes,
    noToPool: pool.reserveNo,
  } satisfies LiquidityAddedEvent);

  for (const step of steps) {
    if (step.action === "join") {
      const joined = joinPool(pool, step.amount, step.feeBps, {
        shares: sharesHeld,
        declaredFeeBps: declared,
      });
      if (joined === null) continue;
      events.push({
        kind: "add",
        ...base(),
        provider: USER,
        cstIn: step.amount,
        declaredFeeBps: Number(step.feeBps),
        sharesOut: joined.sharesOut,
        yesToPool: joined.depositYes,
        noToPool: joined.depositNo,
      } satisfies LiquidityAddedEvent);
      pool = joined.pool;
      sharesHeld += joined.sharesOut;
      declared = step.feeBps;
    } else if (step.action === "removeHalf") {
      const shares = sharesHeld / 2n;
      if (shares === 0n) continue;
      const removed = removeLiquidity(pool, shares, declared);
      events.push({
        kind: "remove",
        ...base(),
        provider: USER,
        sharesIn: shares,
        yesOut: removed.yesOut,
        noOut: removed.noOut,
        feesOut: 0n,
      } satisfies LiquidityRemovedEvent);
      pool = removed.pool;
      sharesHeld -= shares;
    } else if (step.action === "revote") {
      // No event consumed by replay; the vote only changes future fees.
      pool = {
        ...pool,
        feeWeight: pool.feeWeight - sharesHeld * declared + sharesHeld * step.feeBps,
      };
      declared = step.feeBps;
    } else {
      const side = step.action === "betYes" ? "yes" : "no";
      const result = applyBet(side, pool, step.amount);
      events.push({
        kind: "bet",
        ...base(),
        user: USER,
        side,
        cstIn: step.amount,
        netIn: result.net,
        tokensOut: result.tokensOut,
      } satisfies BetEvent);
      pool = result.pool;
    }
  }
  return { events, endPool: pool };
}

describe("applyPoolEvent", () => {
  it("adds dead shares exactly once, on the opening deposit", () => {
    const opened = openPool(10n ** 18n, 5_000n, 200n);
    const afterOpen = applyPoolEvent(EMPTY_POOL, {
      kind: "add",
      blockNumber: 1n,
      logIndex: 0,
      transactionHash: HEX,
      provider: USER,
      cstIn: 10n ** 18n,
      declaredFeeBps: 200,
      sharesOut: opened.sharesOut,
      yesToPool: opened.pool.reserveYes,
      noToPool: opened.pool.reserveNo,
      timestamp: null,
    });
    expect(afterOpen.totalShares).toBe(opened.sharesOut + DEAD_SHARES);
    expect(afterOpen.totalShares).toBe(opened.pool.totalShares);
  });

  it("replays bets from netIn, not from the current fee", () => {
    // A bet recorded at a 5% fee replays exactly even though replay state
    // knows nothing about historical votes.
    const opened = openPool(1_000n * ONE, 5_000n, 500n).pool;
    const executed = applyBet("yes", opened, 100n * ONE);
    const replayed = applyPoolEvent(
      { ...opened, feeWeight: 0n }, // replay has no vote ledger
      {
        kind: "bet",
        blockNumber: 1n,
        logIndex: 1,
        transactionHash: HEX,
        user: USER,
        side: "yes",
        cstIn: 100n * ONE,
        netIn: executed.net,
        tokensOut: executed.tokensOut,
        timestamp: null,
      },
    );
    expect(replayed.reserveYes).toBe(executed.pool.reserveYes);
    expect(replayed.reserveNo).toBe(executed.pool.reserveNo);
    expect(replayed.feeReserve).toBe(executed.pool.feeReserve);
    expect(replayed.accFeePerShare).toBe(executed.pool.accFeePerShare);
  });
});

describe("replayRound", () => {
  it("property: replaying emitted events reconstructs the exact end pool (fee votes and all)", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 10n ** 15n, max: 10n ** 23n }),
        fc.bigInt({ min: 100n, max: 9_900n }),
        fc.bigInt({ min: 0n, max: 1_000n }),
        fc.array(arbStep, { maxLength: 12 }),
        (openAmount, probBps, openFee, steps) => {
          const { events, endPool } = simulate(openAmount, probBps, openFee, steps);
          const replayed = replayRound(events).pool;
          // Everything except the vote ledger (not event-sourced) must match.
          expect(replayed.reserveYes).toBe(endPool.reserveYes);
          expect(replayed.reserveNo).toBe(endPool.reserveNo);
          expect(replayed.totalShares).toBe(endPool.totalShares);
          expect(replayed.accFeePerShare).toBe(endPool.accFeePerShare);
          expect(replayed.feeReserve).toBe(endPool.feeReserve);
        },
      ),
    );
  });

  it("property: every chart point is a probability in [0, 1]", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 10n ** 15n, max: 10n ** 23n }),
        fc.bigInt({ min: 100n, max: 9_900n }),
        fc.array(arbStep, { maxLength: 12 }),
        (openAmount, probBps, steps) => {
          const { events } = simulate(openAmount, probBps, 200n, steps);
          const { points } = replayRound(events);
          expect(points.length).toBeGreaterThan(0);
          for (const point of points) {
            expect(point.probability).toBeGreaterThanOrEqual(0);
            expect(point.probability).toBeLessThanOrEqual(1);
          }
        },
      ),
    );
  });

  it("the opening point sits at the first LP's chosen odds", () => {
    const { events } = simulate(1_000n * ONE, 3_000n, 200n, []);
    const { points } = replayRound(events);
    expect(points[0].probability).toBeCloseTo(0.3, 3);
  });

  it("the sandbox flow: fee changes between bets stay exact", () => {
    const steps: SimStep[] = [
      { action: "betYes", amount: 100n * ONE, feeBps: 0n },
      { action: "revote", amount: 0n, feeBps: 900n },
      { action: "betNo", amount: 50n * ONE, feeBps: 0n },
      { action: "join", amount: 250n * ONE, feeBps: 100n },
      { action: "betYes", amount: 40n * ONE, feeBps: 0n },
      { action: "removeHalf", amount: 0n, feeBps: 0n },
    ];
    const { events, endPool } = simulate(2_000n * ONE, 4_500n, 150n, steps);
    const replayed = replayRound(events).pool;
    expect(replayed.reserveYes).toBe(endPool.reserveYes);
    expect(replayed.reserveNo).toBe(endPool.reserveNo);
    expect(replayed.feeReserve).toBe(endPool.feeReserve);
    expect(currentFeeBps(endPool) >= 0n).toBe(true);
  });
});

describe("sortEvents", () => {
  it("orders by block then log index", () => {
    const mk = (blockNumber: bigint, logIndex: number) => ({ blockNumber, logIndex });
    const sorted = sortEvents([mk(2n, 0), mk(1n, 5), mk(1n, 2), mk(3n, 1)]);
    expect(sorted.map((e) => [e.blockNumber, e.logIndex])).toEqual([
      [1n, 2],
      [1n, 5],
      [2n, 0],
      [3n, 1],
    ]);
  });
});
