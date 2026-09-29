import fc from "fast-check";
import { describe, expect, it } from "vitest";
import vectors from "@/test/fixtures/contract-vectors.json";
import {
  applyBet,
  applyBetWithNet,
  BPS,
  buyAmount,
  ceilDiv,
  claimValue,
  currentFeeBps,
  DEAD_SHARES,
  EMPTY_POOL,
  entryProbability,
  feeAfterDeclarationChange,
  joinPool,
  lpPositionValueFloat,
  MAX_FEE_BPS,
  minTokensOutForSlippage,
  ONE,
  openPool,
  pendingFees,
  poolIsTradable,
  positionValueAtProbability,
  probabilityFloat,
  quoteBet,
  removeLiquidity,
  takeFee,
  type PoolState,
} from "./math";

const LIQ = 10_000n * ONE;

/** A funded 50/50 pool with a 2% fee vote, like the local sandbox seeds. */
function pool(overrides: Partial<PoolState> = {}): PoolState {
  return {
    reserveYes: LIQ,
    reserveNo: LIQ,
    totalShares: LIQ,
    accFeePerShare: 0n,
    feeReserve: 0n,
    feeWeight: LIQ * 200n,
    ...overrides,
  };
}

const arbAmount = fc.bigInt({ min: 1n, max: 10n ** 24n }); // up to 1M CST
const arbFee = fc.bigInt({ min: 0n, max: MAX_FEE_BPS });
const arbReserve = fc.bigInt({ min: ONE / 1000n, max: 10n ** 27n });
const arbProb = fc.bigInt({ min: 100n, max: 9_900n });
const arbLiquidity = fc.bigInt({ min: 10n ** 15n, max: 10n ** 24n });

describe("ceilDiv / takeFee", () => {
  it("matches Solidity's _ceilDiv on exact and inexact divisions", () => {
    expect(ceilDiv(10n, 5n)).toBe(2n);
    expect(ceilDiv(11n, 5n)).toBe(3n);
    expect(() => ceilDiv(1n, 0n)).toThrow();
    expect(() => ceilDiv(-1n, 2n)).toThrow();
  });

  it("property: fee + net === amount, fee rounds down", () => {
    fc.assert(
      fc.property(arbAmount, arbFee, (amount, feeBps) => {
        const { fee, net } = takeFee(amount, feeBps);
        expect(fee + net).toBe(amount);
        expect(fee).toBe((amount * feeBps) / BPS);
      }),
    );
  });
});

describe("the fee vote", () => {
  it("currentFeeBps is feeWeight / totalShares, floored, and 0 when unopened", () => {
    expect(currentFeeBps(EMPTY_POOL)).toBe(0n);
    expect(currentFeeBps({ feeWeight: 300n * LIQ, totalShares: LIQ })).toBe(300n);
    expect(currentFeeBps({ feeWeight: 999n, totalShares: 1000n })).toBe(0n);
  });

  it("property: the average lies within [min, max] of two holders' votes", () => {
    fc.assert(
      fc.property(arbLiquidity, arbLiquidity, arbFee, arbFee, (sharesA, sharesB, feeA, feeB) => {
        const feeWeight = sharesA * feeA + sharesB * feeB;
        const avg = currentFeeBps({ feeWeight, totalShares: sharesA + sharesB });
        const lo = feeA < feeB ? feeA : feeB;
        const hi = feeA > feeB ? feeA : feeB;
        expect(avg >= lo).toBe(true);
        expect(avg <= hi).toBe(true);
      }),
    );
  });

  it("property: feeAfterDeclarationChange is monotone in the new vote", () => {
    fc.assert(
      fc.property(
        arbLiquidity,
        fc.bigInt({ min: 1n, max: 10n ** 24n }),
        arbFee,
        arbFee,
        arbFee,
        (total, lpShares, oldFee, a, b) => {
          const shares = lpShares > total ? total : lpShares;
          const p = { feeWeight: total * oldFee, totalShares: total };
          const feeA = feeAfterDeclarationChange(p, shares, oldFee, a);
          const feeB = feeAfterDeclarationChange(p, shares, oldFee, b);
          if (a <= b) expect(feeA <= feeB).toBe(true);
          else expect(feeA >= feeB).toBe(true);
        },
      ),
    );
  });

  it("re-declaring everything at one value pins the average to it", () => {
    const p = { feeWeight: LIQ * 200n, totalShares: LIQ };
    expect(feeAfterDeclarationChange(p, LIQ, 200n, 700n)).toBe(700n);
  });
});

describe("buyAmount / quoteBet / applyBet", () => {
  it("refuses to price a bet into a pool without liquidity", () => {
    expect(() => applyBet("yes", EMPTY_POOL, ONE)).toThrow(/no liquidity/);
    expect(() => applyBet("no", pool({ reserveNo: 0n }), ONE)).toThrow(/no liquidity/);
  });

  it("property: the pool never loses — k never decreases, reserves never empty", () => {
    fc.assert(
      fc.property(arbAmount, arbFee, arbReserve, arbReserve, (cstIn, feeBps, rY, rN) => {
        const p = pool({ reserveYes: rY, reserveNo: rN, feeWeight: LIQ * feeBps });
        const after = applyBet("yes", p, cstIn).pool;
        expect(after.reserveYes * after.reserveNo >= rY * rN).toBe(true);
        expect(after.reserveYes >= 1n).toBe(true);
        expect(after.reserveNo >= 1n).toBe(true);
      }),
    );
  });

  it("property: quote equals execution for both sides, at any fee vote", () => {
    fc.assert(
      fc.property(arbAmount, arbFee, arbReserve, arbReserve, (cstIn, feeBps, rY, rN) => {
        const p = pool({ reserveYes: rY, reserveNo: rN, feeWeight: LIQ * feeBps });
        expect(quoteBet("yes", p, cstIn)).toBe(applyBet("yes", p, cstIn).tokensOut);
        expect(quoteBet("no", p, cstIn)).toBe(applyBet("no", p, cstIn).tokensOut);
      }),
    );
  });

  it("property: tokensOut is at least net and below net + reserveOut", () => {
    fc.assert(
      fc.property(arbAmount, arbFee, arbReserve, arbReserve, (cstIn, feeBps, rY, rN) => {
        const p = pool({ reserveYes: rY, reserveNo: rN, feeWeight: LIQ * feeBps });
        const { net } = takeFee(cstIn, currentFeeBps(p));
        const out = applyBet("yes", p, cstIn).tokensOut;
        expect(out >= net).toBe(true);
        expect(out < net + rY).toBe(true);
      }),
    );
  });

  it("property: the net floor holds even against wei-dust pools — the guaranteed exit after a full LP rug", () => {
    // A rugged pool is drained to dead-share dust; a one-sided holder can
    // still pair up because a bet MINTS its net input in tokens regardless
    // of reserves. This is the property the exit UX depends on.
    const arbDust = fc.bigInt({ min: 1n, max: 10n ** 6n });
    fc.assert(
      fc.property(arbAmount, arbFee, arbDust, arbDust, (cstIn, feeBps, rY, rN) => {
        const p = pool({ reserveYes: rY, reserveNo: rN, feeWeight: LIQ * feeBps });
        const { net } = takeFee(cstIn, currentFeeBps(p));
        expect(applyBet("yes", p, cstIn).tokensOut >= net).toBe(true);
        expect(applyBet("no", p, cstIn).tokensOut >= net).toBe(true);
      }),
    );
  });

  it("property: betting YES raises P(YES); betting NO lowers it", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: ONE, max: 10n ** 23n }), (cstIn) => {
        const p = pool();
        const pBefore = probabilityFloat(p) as number;
        expect(probabilityFloat(applyBet("yes", p, cstIn).pool) as number).toBeGreaterThan(pBefore);
        expect(probabilityFloat(applyBet("no", p, cstIn).pool) as number).toBeLessThan(pBefore);
      }),
    );
  });

  it("property: fee escrow and accumulator advance exactly at the voted fee", () => {
    fc.assert(
      fc.property(arbAmount, arbFee, (cstIn, feeBps) => {
        const p = pool({ feeWeight: LIQ * feeBps });
        const { fee } = takeFee(cstIn, feeBps);
        const after = applyBet("yes", p, cstIn).pool;
        expect(after.feeReserve).toBe(fee);
        expect(after.accFeePerShare).toBe((fee * ONE) / p.totalShares);
      }),
    );
  });

  it("applyBetWithNet reproduces applyBet when given the same split", () => {
    fc.assert(
      fc.property(arbAmount, arbFee, (cstIn, feeBps) => {
        const p = pool({ feeWeight: LIQ * feeBps });
        const { fee, net } = takeFee(cstIn, currentFeeBps(p));
        expect(applyBetWithNet("yes", p, fee, net)).toEqual(applyBet("yes", p, cstIn));
      }),
    );
  });

  it("quotes 0 for unfunded or drained pools", () => {
    expect(quoteBet("yes", EMPTY_POOL, ONE)).toBe(0n);
    expect(quoteBet("no", pool({ reserveYes: 0n }), ONE)).toBe(0n);
    expect(poolIsTradable(EMPTY_POOL)).toBe(false);
  });
});

describe("openPool", () => {
  it("property: conserves both sides, prices at the request, seeds the vote", () => {
    fc.assert(
      fc.property(arbLiquidity, arbProb, arbFee, (cstIn, prob, feeBps) => {
        const { pool: p, sharesOut, excessYes, excessNo } = openPool(cstIn, prob, feeBps);
        expect(p.reserveYes + excessYes).toBe(cstIn);
        expect(p.reserveNo + excessNo).toBe(cstIn);
        expect(sharesOut).toBe(cstIn - DEAD_SHARES);
        expect(p.totalShares).toBe(cstIn);
        expect(p.feeWeight).toBe(cstIn * feeBps);
        expect(currentFeeBps(p)).toBe(feeBps);
        const implied = probabilityFloat(p) as number;
        expect(Math.abs(implied - Number(prob) / 10_000)).toBeLessThan(0.0002);
      }),
    );
  });

  it("rejects bad deposits, odds, and fee votes", () => {
    expect(() => openPool(10n ** 15n - 1n, 5_000n, 200n)).toThrow(/minimum/);
    expect(() => openPool(LIQ, 99n, 200n)).toThrow(/probability/);
    expect(() => openPool(LIQ, 9_901n, 200n)).toThrow(/probability/);
    expect(() => openPool(LIQ, 5_000n, 1_001n)).toThrow(/cap/);
  });
});

describe("joinPool", () => {
  const arbSkewedPool = fc
    .tuple(arbLiquidity, arbProb, fc.bigInt({ min: 1n, max: 10n ** 23n }), fc.boolean(), arbFee)
    .map(([liq, prob, skew, skewYes, fee]) => {
      let p = openPool(liq, prob, fee).pool;
      p = applyBet(skewYes ? "yes" : "no", p, skew).pool;
      return p;
    });

  it("property: joining never moves the price and conserves tokens", () => {
    fc.assert(
      fc.property(arbSkewedPool, arbAmount, arbFee, (p, cstIn, decl) => {
        const result = joinPool(p, cstIn, decl);
        if (result === null) return; // deposit too small to mint one share
        const before = probabilityFloat(p) as number;
        const after = probabilityFloat(result.pool) as number;
        expect(Math.abs(after - before)).toBeLessThan(0.0002);
        expect(result.depositYes + result.excessYes).toBe(cstIn);
        expect(result.depositNo + result.excessNo).toBe(cstIn);
      }),
    );
  });

  it("property: a joiner's instant pro-rata claim never exceeds their deposit", () => {
    fc.assert(
      fc.property(arbSkewedPool, arbAmount, (p, cstIn) => {
        const result = joinPool(p, cstIn, 200n);
        if (result === null) return;
        const claimYes = (result.pool.reserveYes * result.sharesOut) / result.pool.totalShares;
        const claimNo = (result.pool.reserveNo * result.sharesOut) / result.pool.totalShares;
        expect(claimYes <= result.depositYes).toBe(true);
        expect(claimNo <= result.depositNo).toBe(true);
      }),
    );
  });

  it("property: the joiner's vote shifts the ledger exactly (whole position re-declared)", () => {
    fc.assert(
      fc.property(arbSkewedPool, arbAmount, arbFee, arbFee, (p, cstIn, oldDecl, newDecl) => {
        // Simulate an existing position of a third of the pool at oldDecl.
        const existingShares = p.totalShares / 3n;
        const primed = { ...p, feeWeight: p.feeWeight + existingShares * oldDecl };
        const result = joinPool(primed, cstIn, newDecl, {
          shares: existingShares,
          declaredFeeBps: oldDecl,
        });
        if (result === null) return;
        const expectedWeight =
          primed.feeWeight -
          existingShares * oldDecl +
          (existingShares + result.sharesOut) * newDecl;
        expect(result.pool.feeWeight).toBe(expectedWeight);
      }),
    );
  });

  it("returns null for drained pools and dust deposits", () => {
    expect(joinPool(pool({ reserveYes: 0n, reserveNo: 100n }), ONE, 200n)).toBeNull();
    expect(joinPool(pool({ reserveYes: 100n, reserveNo: 0n }), ONE, 200n)).toBeNull();
    expect(joinPool(pool({ reserveYes: LIQ * 3n, totalShares: LIQ / 2n }), 1n, 200n)).toBeNull();
  });
});

describe("removeLiquidity", () => {
  it("rejects burning zero shares or more shares than exist", () => {
    expect(() => removeLiquidity(pool(), 0n, 200n)).toThrow(/bad share amount/);
    expect(() => removeLiquidity(pool(), LIQ + 1n, 200n)).toThrow(/bad share amount/);
    expect(removeLiquidity(pool(), LIQ, 200n)).toMatchObject({ yesOut: LIQ, noOut: LIQ });
  });

  it("property: add-then-remove can never pay out more than went in", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 23n }),
        fc.boolean(),
        fc.bigInt({ min: 10n ** 6n, max: 10n ** 24n }),
        (skew, skewYes, add) => {
          let p = openPool(LIQ, 5_000n, 200n).pool;
          p = applyBet(skewYes ? "yes" : "no", p, skew).pool;
          const joined = joinPool(p, add, 500n);
          if (joined === null) return;
          const { yesOut, noOut } = removeLiquidity(joined.pool, joined.sharesOut, 500n);
          expect(yesOut + joined.excessYes <= add).toBe(true);
          expect(noOut + joined.excessNo <= add).toBe(true);
        },
      ),
    );
  });

  it("property: withdrawals are pro-rata and departing shares stop voting", () => {
    fc.assert(
      fc.property(
        arbReserve,
        arbReserve,
        fc.bigInt({ min: 1n, max: 10n ** 24n }),
        arbFee,
        (rY, rN, shares, decl) => {
          const total = 10n ** 24n;
          const p = pool({
            reserveYes: rY,
            reserveNo: rN,
            totalShares: total,
            feeWeight: total * decl,
          });
          const { yesOut, noOut, pool: after } = removeLiquidity(p, shares, decl);
          expect(yesOut).toBe((rY * shares) / total);
          expect(noOut).toBe((rN * shares) / total);
          expect(after.feeWeight).toBe(p.feeWeight - shares * decl);
        },
      ),
    );
  });
});

describe("fees and positions", () => {
  it("pendingFees mirrors the MasterChef formula", () => {
    expect(pendingFees(100n * ONE, ONE / 100n, 0n)).toBe(ONE);
    expect(pendingFees(100n * ONE, ONE / 100n, ONE / 2n)).toBe(ONE / 2n);
  });

  it("claimValue pays the winning side 1:1 and the losing side nothing", () => {
    expect(claimValue(7n * ONE, 3n * ONE, true)).toBe(7n * ONE);
    expect(claimValue(7n * ONE, 3n * ONE, false)).toBe(3n * ONE);
  });

  it("positionValueAtProbability interpolates between the two claims", () => {
    expect(positionValueAtProbability(10n * ONE, 0n, 0.5)).toBeCloseTo(5);
    expect(positionValueAtProbability(0n, 10n * ONE, 0.25)).toBeCloseTo(7.5);
  });

  it("entryProbability is cost per token", () => {
    expect(entryProbability(50n * ONE, 100n * ONE)).toBeCloseTo(0.5);
    expect(entryProbability(ONE, 0n)).toBeNull();
  });

  it("lpPositionValueFloat values a position with no pool share at its unclaimed fees", () => {
    expect(lpPositionValueFloat(pool(), 0n, 3n * ONE)).toBe(3);
    expect(lpPositionValueFloat(EMPTY_POOL, 5n * ONE, ONE / 2n)).toBe(0.5);
  });

  it("lpPositionValueFloat marks a balanced pool's reserves at par", () => {
    // All shares of a 50/50 pool: 10,000 YES + 10,000 NO, each worth 0.5.
    expect(lpPositionValueFloat(pool(), LIQ, 0n)).toBeCloseTo(10_000);
    expect(lpPositionValueFloat(pool(), LIQ / 4n, 2n * ONE)).toBeCloseTo(2_502);
  });

  it("property: lpPositionValueFloat lies between the pro-rata YES and NO withdrawals", () => {
    fc.assert(
      fc.property(
        arbReserve,
        arbReserve,
        fc.bigInt({ min: 1n, max: 10n ** 24n }),
        (rY, rN, shares) => {
          const total = 10n ** 24n;
          const p = pool({ reserveYes: rY, reserveNo: rN, totalShares: total });
          const { yesOut, noOut } = removeLiquidity(p, shares, 0n);
          const lo = Number(yesOut < noOut ? yesOut : noOut) / 1e18;
          const hi = Number(yesOut > noOut ? yesOut : noOut) / 1e18;
          const value = lpPositionValueFloat(p, shares, 0n);
          expect(value).toBeGreaterThanOrEqual(lo * (1 - 1e-12));
          expect(value).toBeLessThanOrEqual(hi * (1 + 1e-12));
        },
      ),
    );
  });

  it("minTokensOutForSlippage rounds down and validates its input", () => {
    expect(minTokensOutForSlippage(10_000n, 50)).toBe(9_950n);
    expect(() => minTokensOutForSlippage(1n, -1)).toThrow();
    expect(() => minTokensOutForSlippage(1n, 10_001)).toThrow();
  });
});

// ---------------------------------------------------------------------
// Differential tests: every number produced by the REAL contract
// (script/GenerateVectors.s.sol) must match this library bit-for-bit.
// ---------------------------------------------------------------------

function poolFromVector(v: Record<string, string>, prefix: string): PoolState {
  return {
    reserveYes: BigInt(v[`${prefix}ReserveYes`]),
    reserveNo: BigInt(v[`${prefix}ReserveNo`]),
    totalShares: BigInt(v[`${prefix}TotalShares`]),
    accFeePerShare: BigInt(v[`${prefix}AccFeePerShare`]),
    feeReserve: BigInt(v[`${prefix}FeeReserve`]),
    feeWeight: BigInt(v[`${prefix}FeeWeight`]),
  };
}

function expectPoolMatches(actual: PoolState, v: Record<string, string>, prefix: string) {
  const expected = poolFromVector(v, prefix);
  expect(actual.reserveYes).toBe(expected.reserveYes);
  expect(actual.reserveNo).toBe(expected.reserveNo);
  expect(actual.totalShares).toBe(expected.totalShares);
  expect(actual.accFeePerShare).toBe(expected.accFeePerShare);
  expect(actual.feeReserve).toBe(expected.feeReserve);
  expect(actual.feeWeight).toBe(expected.feeWeight);
  expect(currentFeeBps(actual)).toBe(BigInt(v[`${prefix}PoolFeeBps`]));
}

describe("differential vectors from the contract", () => {
  it(`buyAmount matches the contract on ${vectors.buyAmount.length} magnitude-swept cases`, () => {
    for (const v of vectors.buyAmount) {
      expect(buyAmount(BigInt(v.reserveOut), BigInt(v.reserveIn), BigInt(v.net))).toBe(
        BigInt(v.tokensOut),
      );
    }
  });

  it(`replays ${vectors.flows.length} executed open→bet→join→re-vote→bet→remove flows exactly`, () => {
    for (const raw of vectors.flows) {
      const v = raw as unknown as Record<string, string> & {
        openFeeBps: number;
        joinFeeBps: number;
        revoteFeeBps: number;
        betYes: boolean;
      };

      // Open.
      const opened = openPool(BigInt(v.liq), BigInt(v.probBps), BigInt(v.openFeeBps));
      expectPoolMatches(opened.pool, v, "open");
      expect(opened.sharesOut).toBe(BigInt(v.openShares));

      // Bet 1 (charged at the opener's declared fee).
      const bet1 = applyBet(v.betYes ? "yes" : "no", opened.pool, BigInt(v.betAmount));
      expect(bet1.tokensOut).toBe(BigInt(v.betOut));
      expectPoolMatches(bet1.pool, v, "postBet");

      // Join by a second LP with their own vote.
      const joined = joinPool(bet1.pool, BigInt(v.joinAmount), BigInt(v.joinFeeBps));
      expect(joined).not.toBeNull();
      expect(joined!.sharesOut).toBe(BigInt(v.joinShares));
      expect(joined!.excessYes).toBe(BigInt(v.joinerYesAfterJoin));
      expect(joined!.excessNo).toBe(BigInt(v.joinerNoAfterJoin));
      expectPoolMatches(joined!.pool, v, "postJoin");

      // The opener re-votes their whole position.
      const openerShares = BigInt(v.openShares) + DEAD_SHARES; // opener + dead shares both vote openFeeBps
      const revotedWeight =
        joined!.pool.feeWeight -
        BigInt(v.openShares) * BigInt(v.openFeeBps) +
        BigInt(v.openShares) * BigInt(v.revoteFeeBps);
      const revoted: PoolState = { ...joined!.pool, feeWeight: revotedWeight };
      expectPoolMatches(revoted, v, "postRevote");
      expect(openerShares > 0n).toBe(true);

      // Bet 2 at the shifted average.
      const bet2 = applyBet("yes", revoted, BigInt(v.bet2Amount));
      expect(bet2.tokensOut).toBe(BigInt(v.bet2Out));
      expectPoolMatches(bet2.pool, v, "postBet2");

      // The opener removes half; their departing shares vote revoteFeeBps.
      const removed = removeLiquidity(bet2.pool, BigInt(v.removeShares), BigInt(v.revoteFeeBps));
      expect(removed.yesOut).toBe(BigInt(v.removeYes));
      expect(removed.noOut).toBe(BigInt(v.removeNo));
      // The remove settles fees; escrow drops by exactly what was paid out.
      const finalPool = {
        ...removed.pool,
        feeReserve: removed.pool.feeReserve - BigInt(v.removeFees),
      };
      expectPoolMatches(finalPool, v, "postRemove");
    }
  });
});
