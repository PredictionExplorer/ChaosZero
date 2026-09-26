import { describe, expect, it } from "vitest";
import fixture from "@/test/fixtures/independent-contract-vectors.json";
import { quoteIndependentTrade } from "@/shared/independent-math";
import { ONE } from "@/shared/math";
import { snapshot } from "./test-fixtures";
import {
  effectiveQuestions,
  fixedAmounts,
  fundingBreakdown,
  heldContributions,
  independentPortfolioValue,
  MIN_AUTO_TOP_UP,
  nextAbsorption,
  tradeAccess,
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
  it("parses empty and zero gift input without error and preserves exact precision", () => {
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

describe("held contributions and next-trade absorption", () => {
  const absorbing = (funded: boolean) => {
    const state = snapshot();
    state.funded = funded;
    for (const q of state.questions) q.funded = funded;
    state.funding = {
      ...state.funding!,
      carryUsed: funded ? 0n : 16n * ONE,
      availableCarry: funded ? 0n : 16n * ONE,
      totalFunding: 24n * ONE + 3n,
      allocations: fixedAmounts([
        3n * ONE + 1n,
        3n * ONE + 1n,
        3n * ONE + 1n,
        3n * ONE,
        3n * ONE,
        3n * ONE,
        3n * ONE,
        3n * ONE,
      ]),
      canFund: true,
      unallocated: funded ? 24n * ONE + 3n : 8n * ONE + 3n,
    };
    return state;
  };

  it("pins MIN_AUTO_TOP_UP to the Solidity-generated fixture", () => {
    expect(MIN_AUTO_TOP_UP).toBe(BigInt(fixture.constants.MIN_AUTO_TOP_UP));
  });
  it("derives held CST with the market's saturating custody identity", () => {
    expect(heldContributions(110n, 80n, 20n)).toBe(10n);
    expect(heldContributions(100n, 80n, 20n)).toBe(0n);
    expect(heldContributions(90n, 80n, 20n)).toBe(0n);
  });
  it("quotes against the effective post-absorption pool only when the preview can fund", () => {
    const state = absorbing(true);
    const effective = effectiveQuestions(state);
    expect(effective[0].pool.collateral).toBe(1003n * ONE + 1n);
    expect(effective[7].pool.collateral).toBe(1003n * ONE);
    expect(effective[0].pool.initialYesBps).toBe(state.questions[0].pool.initialYesBps);
    // A deeper pool gives a different (larger) exact quote than the stale one.
    expect(quoteIndependentTrade(effective[0].pool, true, true, 10n * ONE)).toBeGreaterThan(
      quoteIndependentTrade(state.questions[0].pool, true, true, 10n * ONE),
    );
    for (const change of [
      (s: typeof state) => (s.funding = { ...s.funding!, canFund: false }),
      (s: typeof state) => (s.funding = null),
      (s: typeof state) => (s.open = false),
      (s: typeof state) => (s.finalized = true),
    ]) {
      const stale = absorbing(true);
      change(stale);
      expect(nextAbsorption(stale)).toBeNull();
      expect(effectiveQuestions(stale)).toBe(stale.questions);
    }
  });
  it("classifies trading, absorbing, auto-starting and unopenable cycles", () => {
    expect(tradeAccess(snapshot())).toEqual({
      tradeable: true,
      opensPools: false,
      settlesPrevious: false,
      absorbed: 0n,
    });
    expect(tradeAccess(absorbing(true))).toMatchObject({
      tradeable: true,
      opensPools: false,
      absorbed: 24n * ONE + 3n,
    });
    const start = absorbing(false);
    start.funding = { ...start.funding!, needsSettlement: true };
    expect(tradeAccess(start)).toEqual({
      tradeable: true,
      opensPools: true,
      settlesPrevious: true,
      absorbed: 24n * ONE + 3n,
    });
    expect(effectiveQuestions(start).every((q) => q.funded)).toBe(true);
    const stuck = absorbing(false);
    stuck.funding = { ...stuck.funding!, canFund: false };
    expect(tradeAccess(stuck)).toMatchObject({ tradeable: false, opensPools: false });
    const closed = snapshot();
    closed.open = false;
    expect(tradeAccess(closed).tradeable).toBe(false);
  });
  it("splits a placement like RoundFunded: carry, then the caller's gift, then held CST", () => {
    const preview = absorbing(false).funding!;
    expect(fundingBreakdown(preview, 0n)).toEqual({
      carry: 16n * ONE,
      donated: 0n,
      held: 8n * ONE + 3n,
    });
    expect(fundingBreakdown(preview, 5n * ONE)).toEqual({
      carry: 16n * ONE,
      donated: 5n * ONE,
      held: 3n * ONE + 3n,
    });
    // After an unsupported burn the gift first restores backing and is clamped.
    expect(fundingBreakdown({ ...preview, totalFunding: 17n * ONE }, 5n * ONE)).toEqual({
      carry: 16n * ONE,
      donated: ONE,
      held: 0n,
    });
    // A capacity-rejected preview places nothing.
    expect(fundingBreakdown({ ...preview, totalFunding: 0n }, 5n * ONE)).toEqual({
      carry: 0n,
      donated: 0n,
      held: 0n,
    });
  });
});
