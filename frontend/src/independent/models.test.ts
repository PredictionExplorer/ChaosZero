import { describe, expect, it } from "vitest";
import { ONE } from "@/shared/math";
import {
  fixedAmounts,
  independentPortfolioValue,
  parseFundingAmount,
  questionExposure,
  winningClaims,
  type IndependentQuestion,
  type IndependentWallet,
} from "./models";

const owner = "0x1111111111111111111111111111111111111111" as const;
const zeros = () => fixedAmounts(Array<bigint>(8).fill(0n));
const questions = (): IndependentQuestion[] =>
  Array.from({ length: 8 }, () => ({
    pool: { collateral: 1000n * ONE, yes: 0n, no: 0n, initialYesBps: 5000 },
    funded: true,
    usedHistory: false,
    escrowRemaining: 0n,
  }));
const user = (): IndependentWallet => ({
  owner,
  yes: fixedAmounts([5n * ONE, ...zeros().slice(1)]),
  no: fixedAmounts([2n * ONE, ...zeros().slice(1)]),
  balance: 100n * ONE,
  allowance: 0n,
});

describe("independent settlement and wallet models", () => {
  it("uses full finality rather than known comparisons or displayed prices for payouts", () => {
    expect(winningClaims(user(), false, 255)).toBe(0n);
    expect(winningClaims(user(), true, 1)).toBe(5n * ONE);
    expect(winningClaims(user(), true, 0)).toBe(2n * ONE);
    expect(winningClaims(null, true, 255)).toBe(0n);
  });
  it("keeps old escrow separate from zeroed active question reserves", () => {
    const q = questions()[0];
    q.escrowRemaining = 5n * ONE;
    expect(questionExposure(q, true, true, true)).toEqual({
      collateral: 0n,
      obligation: 5n * ONE,
      reserve: 0n,
    });
    q.pool.yes = 10n * ONE;
    q.pool.no = 20n * ONE;
    expect(questionExposure(q, false, false, true)).toEqual({
      collateral: 1000n * ONE,
      obligation: 20n * ONE,
      reserve: 980n * ONE,
    });
    expect(questionExposure(q, false, true, true).reserve).toBe(990n * ONE);
    expect(questionExposure(q, false, true, false).reserve).toBe(980n * ONE);
  });
  it("values matched sets exactly and unmatched units from only their question", () => {
    const q = questions();
    const before = independentPortfolioValue({
      user: user(),
      questions: q,
      finalized: false,
      values: 0,
    });
    expect(before).toEqual({ matched: 2n * ONE, claimable: 0n, indicative: (35n * ONE) / 10n });
    q[1].pool.yes = 999n * ONE;
    expect(
      independentPortfolioValue({ user: user(), questions: q, finalized: false, values: 0 }),
    ).toEqual(before);
    expect(
      independentPortfolioValue({ user: user(), questions: q, finalized: true, values: 1 })
        .indicative,
    ).toBe(5n * ONE);
  });
  it("does not invent an indicative price for unbacked unmatched units", () => {
    const q = questions();
    q[0].pool.collateral = 0n;
    expect(
      independentPortfolioValue({ user: user(), questions: q, finalized: false, values: 0 })
        .indicative,
    ).toBeNull();
    const paired = user();
    paired.yes = paired.no;
    expect(
      independentPortfolioValue({ user: paired, questions: q, finalized: false, values: 0 })
        .indicative,
    ).toBe(2n * ONE);
    expect(
      independentPortfolioValue({ user: null, questions: q, finalized: false, values: 0 }),
    ).toEqual({ indicative: null, matched: 0n, claimable: 0n });
  });
  it("accepts deliberate zero-new-CST funding and preserves exact precision", () => {
    expect(parseFundingAmount("")).toEqual({ value: 0n, error: null });
    expect(parseFundingAmount("0")).toEqual({ value: 0n, error: null });
    expect(parseFundingAmount("1,000.000000000000000001").value).toBe(1000n * ONE + 1n);
    for (const bad of ["-1", ".", "1e4", "text", "0.0000000000000000001"])
      expect(parseFundingAmount(bad).error).not.toBeNull();
  });
  it("rejects malformed fixed-length balances", () => {
    expect(() => fixedAmounts([1n])).toThrow();
    expect(() => fixedAmounts([-1n, ...zeros().slice(1)])).toThrow();
  });
});
