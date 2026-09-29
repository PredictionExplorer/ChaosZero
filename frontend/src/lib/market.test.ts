import { describe, expect, it } from "vitest";
import type { RoundSnapshot } from "./market";
import {
  canAddLiquidity,
  canClaim,
  canMintSets,
  displayedProbability,
  hasLpPosition,
  hasPosition,
  isResolvable,
  isTradable,
  poolFeeBps,
  positionValueFloat,
  roundPhase,
  thresholdProgress,
  totalLiquidity,
} from "./market";
import { ONE } from "./math";

const SERIES = "0x1111111111111111111111111111111111111111" as const;
const CST = "0x2222222222222222222222222222222222222222" as const;
const GAME = "0x3333333333333333333333333333333333333333" as const;

function snapshot(overrides: Partial<RoundSnapshot> = {}): RoundSnapshot {
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
    pool: {
      // NO-heavy pool: P(YES) = 3000/(1000+3000) = 75%.
      reserveYes: 1_000n * ONE,
      reserveNo: 3_000n * ONE,
      totalShares: 1_000n * ONE,
      accFeePerShare: 0n,
      feeReserve: 5n * ONE,
      feeWeight: 1_000n * ONE * 250n, // 2.5% weighted fee
    },
    cstAddress: CST,
    gameAddress: GAME,
    ...overrides,
  };
}

/** A round funded ahead of time: the game hasn't reached it, no threshold. */
function futureSnapshot(overrides: Partial<RoundSnapshot> = {}): RoundSnapshot {
  return snapshot({
    roundId: 7n,
    gameRoundNum: 5n,
    thresholdKnown: false,
    threshold: 0n,
    currentCount: 0n,
    prevRoundCount: 640n, // round 6's count so far — the forming threshold
    ...overrides,
  });
}

describe("roundPhase", () => {
  it("walks the full lifecycle", () => {
    expect(roundPhase(snapshot({ initialized: false }))).toBe("uninitialized");
    expect(roundPhase(futureSnapshot())).toBe("future");
    expect(roundPhase(snapshot())).toBe("live");
    expect(roundPhase(snapshot({ currentCount: 801n }))).toBe("decided");
    expect(roundPhase(snapshot({ gameRoundNum: 6n }))).toBe("ended");
    expect(roundPhase(snapshot({ resolved: true, yesWon: true }))).toBe("resolved");
  });

  it("a tie at the threshold is NOT decided (strictly greater required)", () => {
    expect(roundPhase(snapshot({ currentCount: 800n }))).toBe("live");
  });

  it("resolved wins over everything else", () => {
    expect(roundPhase(snapshot({ resolved: true, gameRoundNum: 9n, currentCount: 10_000n }))).toBe(
      "resolved",
    );
  });

  it("a future round can never be decided, whatever the counts claim", () => {
    // The threshold isn't knowable, so certainty is impossible pre-round.
    expect(roundPhase(futureSnapshot({ currentCount: 10_000n }))).toBe("future");
  });

  it("an unknown threshold never triggers decided even on the current round", () => {
    // Defensive: the contract always knows the threshold for current rounds,
    // but the guard must sit on thresholdKnown, not on the raw comparison.
    expect(roundPhase(snapshot({ thresholdKnown: false, threshold: 0n, currentCount: 5n }))).toBe(
      "live",
    );
  });
});

describe("tradability and resolvability", () => {
  it("live and future rounds with a funded pool are tradable", () => {
    expect(isTradable(snapshot())).toBe(true);
    expect(isTradable(futureSnapshot())).toBe(true);
    expect(isTradable(snapshot({ pool: { ...snapshot().pool, totalShares: 0n } }))).toBe(false);
    expect(isTradable(futureSnapshot({ pool: { ...snapshot().pool, totalShares: 0n } }))).toBe(
      false,
    );
    expect(isTradable(snapshot({ currentCount: 801n }))).toBe(false);
    expect(isTradable(snapshot({ gameRoundNum: 6n }))).toBe(false);
    expect(isTradable(snapshot({ resolved: true }))).toBe(false);
  });

  it("decided and ended rounds are resolvable; future rounds never are", () => {
    expect(isResolvable(snapshot())).toBe(false);
    expect(isResolvable(snapshot({ currentCount: 801n }))).toBe(true);
    expect(isResolvable(snapshot({ gameRoundNum: 6n }))).toBe(true);
    expect(isResolvable(snapshot({ resolved: true }))).toBe(false);
    expect(isResolvable(futureSnapshot())).toBe(false);
    expect(isResolvable(futureSnapshot({ currentCount: 10_000n }))).toBe(false);
  });

  it("canAddLiquidity: live and future rounds, or open-able uninitialized ones", () => {
    expect(canAddLiquidity(snapshot())).toBe(true);
    expect(canAddLiquidity(snapshot({ initialized: false }))).toBe(true);
    // Any future round can be opened or joined — arbitrarily far ahead.
    expect(canAddLiquidity(futureSnapshot())).toBe(true);
    expect(canAddLiquidity(futureSnapshot({ initialized: false }))).toBe(true);
    expect(canAddLiquidity(futureSnapshot({ initialized: false, roundId: 1_000n }))).toBe(true);
    // Uninitialized but the count already crossed: opening would revert.
    expect(canAddLiquidity(snapshot({ initialized: false, currentCount: 801n }))).toBe(false);
    // Past rounds can never be opened.
    expect(canAddLiquidity(snapshot({ initialized: false, gameRoundNum: 6n }))).toBe(false);
    // Round 0 has no previous round.
    expect(canAddLiquidity(snapshot({ initialized: false, roundId: 0n, gameRoundNum: 0n }))).toBe(
      false,
    );
    expect(canAddLiquidity(snapshot({ currentCount: 801n }))).toBe(false);
    expect(canAddLiquidity(snapshot({ resolved: true }))).toBe(false);
    // Ended rounds are withdraw-only, even for existing LPs.
    expect(canAddLiquidity(snapshot({ gameRoundNum: 6n }))).toBe(false);
  });

  it("canMintSets: open while the market exists and the round isn't over", () => {
    expect(canMintSets(snapshot())).toBe(true);
    expect(canMintSets(futureSnapshot())).toBe(true);
    // Minting stays open on decided rounds: a set is value-neutral.
    expect(canMintSets(snapshot({ currentCount: 801n }))).toBe(true);
    expect(canMintSets(snapshot({ initialized: false }))).toBe(false);
    expect(canMintSets(snapshot({ gameRoundNum: 6n }))).toBe(false);
    expect(canMintSets(snapshot({ resolved: true }))).toBe(false);
  });

  it("canClaim: exactly the resolved phase", () => {
    expect(canClaim(snapshot({ resolved: true }))).toBe(true);
    expect(canClaim(snapshot())).toBe(false);
    expect(canClaim(futureSnapshot())).toBe(false);
    expect(canClaim(snapshot({ gameRoundNum: 6n }))).toBe(false);
  });
});

describe("displayedProbability", () => {
  it("reads the pool while live", () => {
    expect(displayedProbability(snapshot())).toBeCloseTo(0.75);
  });

  it("reads the pool for future rounds too — early positions have a price", () => {
    expect(displayedProbability(futureSnapshot())).toBeCloseTo(0.75);
  });

  it("pins to 1 when decided and to the winner when resolved", () => {
    expect(displayedProbability(snapshot({ currentCount: 801n }))).toBe(1);
    expect(displayedProbability(snapshot({ resolved: true, yesWon: true }))).toBe(1);
    expect(displayedProbability(snapshot({ resolved: true, yesWon: false }))).toBe(0);
  });

  it("is null with no liquidity", () => {
    expect(
      displayedProbability(
        snapshot({ pool: { ...snapshot().pool, reserveYes: 0n, reserveNo: 0n } }),
      ),
    ).toBeNull();
  });
});

describe("positionValueFloat", () => {
  const user = { yesBalance: 10n * ONE, noBalance: 4n * ONE };

  it("resolved: exact claim value", () => {
    expect(positionValueFloat(snapshot({ resolved: true, yesWon: true }), user)).toBeCloseTo(10);
    expect(positionValueFloat(snapshot({ resolved: true, yesWon: false }), user)).toBeCloseTo(4);
  });

  it("decided: YES tokens at full value", () => {
    expect(positionValueFloat(snapshot({ currentCount: 801n }), user)).toBeCloseTo(10);
  });

  it("live: marked at the pool probability", () => {
    expect(positionValueFloat(snapshot(), user)).toBeCloseTo(10 * 0.75 + 4 * 0.25);
  });
});

describe("aggregates and helpers", () => {
  it("totalLiquidity and poolFeeBps read the pool", () => {
    expect(totalLiquidity(snapshot().pool)).toBe(4_000n * ONE);
    expect(poolFeeBps(snapshot().pool)).toBe(250);
  });

  it("hasPosition / hasLpPosition", () => {
    expect(hasPosition({ yesBalance: 0n, noBalance: 0n })).toBe(false);
    expect(hasPosition({ yesBalance: 1n, noBalance: 0n })).toBe(true);
    expect(hasLpPosition({ lpShares: 0n, lpPendingFees: 0n })).toBe(false);
    expect(hasLpPosition({ lpShares: 0n, lpPendingFees: 1n })).toBe(true);
  });

  it("thresholdProgress caps sensibly", () => {
    expect(thresholdProgress({ currentCount: 400n, threshold: 800n })).toBeCloseTo(0.5);
    expect(thresholdProgress({ currentCount: 900n, threshold: 800n })).toBeGreaterThan(1);
    expect(thresholdProgress({ currentCount: 5n, threshold: 0n })).toBe(1);
    expect(thresholdProgress({ currentCount: 0n, threshold: 0n })).toBe(0);
  });
});
