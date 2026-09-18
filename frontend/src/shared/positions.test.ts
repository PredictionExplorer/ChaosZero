import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  collateralBreakdown,
  decodePositionId,
  matchedSets,
  MAX_ROUND_ID,
  portfolioValue,
  positionId,
  totalMatchedSets,
  validateRecipient,
} from "./positions";
import { feasibleReserves, ONE, yesProbabilityBps, type SharedPool } from "./math";

const zero = () => Array<bigint>(8).fill(0n);
const pool = (overrides: Partial<SharedPool> = {}): SharedPool => ({
  collateral: 1000n * ONE,
  yes: zero(),
  no: zero(),
  knownMask: 0,
  values: 0,
  ...overrides,
});
const SENDER = "0x1111111111111111111111111111111111111111" as const;
const MARKET = "0x2222222222222222222222222222222222222222" as const;
const RECIPIENT = "0x3333333333333333333333333333333333333333" as const;

describe("complete sets and standard position identity", () => {
  it("round-trips the full ERC-1155 ID range without cross-cycle or cross-question collisions", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: MAX_ROUND_ID }),
        fc.integer({ min: 0, max: 7 }),
        fc.boolean(),
        (roundId, question, yes) => {
          const id = positionId(roundId, question, yes);
          expect(decodePositionId(id)).toEqual({ roundId, question, yes });
          expect(positionId(roundId, question, !yes)).not.toBe(id);
          expect(positionId(roundId, (question + 1) % 8, yes)).not.toBe(id);
          if (roundId < MAX_ROUND_ID) expect(positionId(roundId + 1n, question, yes)).not.toBe(id);
        },
      ),
      { numRuns: 200 },
    );
    expect(positionId(MAX_ROUND_ID, 7, true)).toBe((1n << 256n) - 1n);
    expect(positionId(0n, 0, false)).toBe(0n);
  });

  it("rejects unencodable identities rather than truncating or wrapping", () => {
    for (const roundId of [-1n, MAX_ROUND_ID + 1n])
      expect(() => positionId(roundId, 0, true)).toThrow();
    for (const question of [-1, 0.5, 8, Number.NaN])
      expect(() => positionId(1n, question, true)).toThrow();
    expect(() => decodePositionId(-1n)).toThrow();
    expect(() => decodePositionId(1n << 256n)).toThrow();
  });

  it("matches only YES and NO from the same question", () => {
    const yes = [10n, 0n, 4n, 7n, 0n, 0n, 0n, 0n];
    const no = [0n, 10n, 8n, 3n, 0n, 0n, 0n, 0n];
    expect(matchedSets(yes, no)).toEqual([0n, 0n, 4n, 3n, 0n, 0n, 0n, 0n]);
    expect(totalMatchedSets(yes, no)).toBe(7n);
    expect(() => matchedSets([1n], zero())).toThrow();
    expect(() => matchedSets([-1n, ...zero().slice(1)], zero())).toThrow();
    expect(() => matchedSets(zero(), [-1n, ...zero().slice(1)])).toThrow();
  });

  it("preserves every joint reserve and marginal price when splitting or merging pairs", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 25 }), { minLength: 16, maxLength: 16 }),
        fc.integer({ min: 0, max: 7 }),
        fc.bigInt({ min: 1n, max: 100n * ONE }),
        (amounts, question, amount) => {
          const before = pool({
            yes: amounts.slice(0, 8).map((x) => BigInt(x) * ONE),
            no: amounts.slice(8).map((x) => BigInt(x) * ONE),
          });
          const nextYes = [...before.yes];
          nextYes[question] += amount;
          const nextNo = [...before.no];
          nextNo[question] += amount;
          const split = {
            ...before,
            collateral: before.collateral + amount,
            yes: nextYes,
            no: nextNo,
          };
          expect(feasibleReserves(split)).toEqual(feasibleReserves(before));
          for (let i = 0; i < 8; i++)
            expect(yesProbabilityBps(split, i)).toBe(yesProbabilityBps(before, i));
          const treasury = collateralBreakdown(split);
          expect(treasury.held).toBe(before.collateral + amount);
          expect(treasury.maximumPayout).toBe(collateralBreakdown(before).maximumPayout + amount);
          expect(treasury.minimumReserve).toBe(collateralBreakdown(before).minimumReserve);
          nextYes[question] -= amount;
          nextNo[question] -= amount;
          expect(feasibleReserves({ ...split, collateral: split.collateral - amount })).toEqual(
            feasibleReserves(before),
          );
        },
      ),
      { numRuns: 40 },
    );
  });

  it("does not confuse split-only held CST with AMM liquidity", () => {
    const state = pool({
      collateral: 10n * ONE,
      yes: [10n * ONE, ...zero().slice(1)],
      no: [10n * ONE, ...zero().slice(1)],
    });
    expect(collateralBreakdown(state)).toEqual({
      held: 10n * ONE,
      maximumPayout: 10n * ONE,
      minimumReserve: 0n,
    });
    expect(yesProbabilityBps(state, 0)).toBeNull();
    expect(portfolioValue(state, state.yes, state.no)).toEqual({
      matchedCollateral: 10n * ONE,
      claimable: 0n,
      indicativeValue: 10n * ONE,
    });
  });

  it("values paired, unmatched, and settled units without double-counting claims", () => {
    const yes = [8n * ONE, 6n * ONE, 0n, 0n, 0n, 0n, 0n, 0n];
    const no = [3n * ONE, 2n * ONE, 0n, 0n, 0n, 0n, 0n, 0n];
    expect(portfolioValue(pool(), yes, no)).toEqual({
      matchedCollateral: 5n * ONE,
      claimable: 0n,
      indicativeValue: (95n * ONE) / 10n,
    });
    expect(portfolioValue(pool({ knownMask: 3, values: 1 }), yes, no)).toEqual({
      matchedCollateral: 5n * ONE,
      claimable: 10n * ONE,
      indicativeValue: 10n * ONE,
    });
    expect(
      portfolioValue(pool({ collateral: 0n }), [ONE, ...zero().slice(1)], zero()).indicativeValue,
    ).toBeNull();
  });

  it("validates transfer destinations without excluding valid receiving contracts", () => {
    expect(validateRecipient("", SENDER, MARKET)).toEqual({ address: null, error: null });
    expect(validateRecipient("invalid", SENDER, MARKET).error).toMatch(/valid/);
    expect(
      validateRecipient("0x0000000000000000000000000000000000000000", SENDER, MARKET).error,
    ).toMatch(/zero/);
    expect(validateRecipient(MARKET, SENDER, MARKET).error).toMatch(/market/);
    expect(validateRecipient(SENDER, SENDER, MARKET).error).toMatch(/connected wallet/);
    expect(validateRecipient(` ${RECIPIENT} `, SENDER, MARKET)).toEqual({
      address: RECIPIENT,
      error: null,
    });
    expect(validateRecipient(RECIPIENT, undefined, MARKET).address).toBe(RECIPIENT);
  });
});
