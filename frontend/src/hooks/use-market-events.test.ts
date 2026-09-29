import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Log } from "viem";
import { getAddress } from "viem";
import { SERIES } from "@/test/fixtures";
import { LOG_BLOCK_HASH as BLOCK_HASH, LOG_TX as TX, encodeLog } from "@/test/logs";
import { decodeScan } from "./use-market-events";

const arbAddress = fc
  .bigInt({ min: 1n, max: (1n << 160n) - 1n })
  .map((n) => getAddress(`0x${n.toString(16).padStart(40, "0")}`));
const arbU256 = fc.bigInt({ min: 0n, max: 2n ** 200n }); // plenty of range, well-formed
const arbRound = fc.bigInt({ min: 0n, max: 10n ** 9n });
const arbBlock = fc.bigInt({ min: 1n, max: 10n ** 9n });
const arbLogIndex = fc.integer({ min: 0, max: 10_000 });

describe("decodeScan: the new lifecycle events", () => {
  it("decodes RoundInitialized (no threshold arg anymore)", () => {
    const { activity, poolEvents } = decodeScan([encodeLog("RoundInitialized", { roundId: 7n })], 7n);
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ kind: "roundInitialized", user: null, amount: 0n, secondary: 0n });
    expect(poolEvents).toHaveLength(0);
  });

  it("decodes ThresholdLocked with the locked value", () => {
    const { activity } = decodeScan([encodeLog("ThresholdLocked", { roundId: 7n, threshold: 950n })], 7n);
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ kind: "thresholdLocked", user: null, secondary: 950n });
  });

  it("filters both to their own round", () => {
    const logs = [
      encodeLog("RoundInitialized", { roundId: 8n }),
      encodeLog("ThresholdLocked", { roundId: 8n, threshold: 1n }),
    ];
    expect(decodeScan(logs, 7n).activity).toHaveLength(0);
  });
});

describe("decodeScan: fuzzed encode/decode round-trips", () => {
  it("property: Bet logs round-trip every field into activity and pool replay", () => {
    fc.assert(
      fc.property(
        arbRound,
        arbAddress,
        fc.boolean(),
        arbU256,
        arbU256,
        arbU256,
        arbBlock,
        arbLogIndex,
        (roundId, user, yes, cstIn, netIn, tokensOut, blockNumber, logIndex) => {
          const log = encodeLog("Bet", { roundId, user, yes, cstIn, netIn, tokensOut }, blockNumber, logIndex);
          const { activity, poolEvents } = decodeScan([log], roundId);

          expect(activity).toHaveLength(1);
          expect(activity[0]).toMatchObject({
            kind: "bet",
            user,
            side: yes ? "yes" : "no",
            amount: cstIn,
            secondary: tokensOut,
            blockNumber,
            logIndex,
            transactionHash: TX,
          });
          expect(poolEvents).toHaveLength(1);
          expect(poolEvents[0]).toMatchObject({ kind: "bet", cstIn, netIn, tokensOut });
        },
      ),
    );
  });

  it("property: LiquidityAdded logs round-trip, fee vote included", () => {
    const arbFee = fc.integer({ min: 0, max: 1_000 });
    fc.assert(
      fc.property(
        arbRound,
        arbAddress,
        arbU256,
        arbFee,
        arbU256,
        arbU256,
        arbU256,
        (roundId, provider, cstIn, declaredFeeBps, sharesOut, yesToPool, noToPool) => {
          const log = encodeLog("LiquidityAdded", {
            roundId,
            provider,
            cstIn,
            declaredFeeBps,
            sharesOut,
            yesToPool,
            noToPool,
          });
          const { activity, poolEvents } = decodeScan([log], roundId);
          expect(activity[0]).toMatchObject({ kind: "add", user: provider, feeBps: declaredFeeBps, amount: cstIn });
          expect(poolEvents[0]).toMatchObject({ kind: "add", declaredFeeBps, sharesOut, yesToPool, noToPool });
        },
      ),
    );
  });

  it("property: ThresholdLocked logs round-trip for any round and value", () => {
    fc.assert(
      fc.property(arbRound, arbU256, arbBlock, arbLogIndex, (roundId, threshold, blockNumber, logIndex) => {
        const log = encodeLog("ThresholdLocked", { roundId, threshold }, blockNumber, logIndex);
        const { activity } = decodeScan([log], roundId);
        expect(activity[0]).toMatchObject({ kind: "thresholdLocked", secondary: threshold, blockNumber, logIndex });
      }),
    );
  });

  it("property: logs for OTHER rounds are always dropped, never mixed in", () => {
    fc.assert(
      fc.property(arbRound, arbRound, arbU256, (roundId, otherRound, threshold) => {
        fc.pre(roundId !== otherRound);
        const logs = [
          encodeLog("ThresholdLocked", { roundId: otherRound, threshold }),
          encodeLog("RoundInitialized", { roundId: otherRound }),
          encodeLog("Resolved", { roundId: otherRound, finalCount: threshold, yesWon: true }),
        ];
        const { activity, poolEvents } = decodeScan(logs, roundId);
        expect(activity).toHaveLength(0);
        expect(poolEvents).toHaveLength(0);
      }),
    );
  });

  it("property: unrecognizable logs never crash the scan", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 32, maxLength: 32 }), arbRound, (topicBytes, roundId) => {
        const junk = {
          address: SERIES,
          topics: [`0x${Buffer.from(topicBytes).toString("hex")}`],
          data: "0x",
          blockNumber: 1n,
          logIndex: 0,
          transactionHash: TX,
          transactionIndex: 0,
          blockHash: BLOCK_HASH,
          removed: false,
        } as Log;
        const { activity, poolEvents } = decodeScan([junk], roundId);
        expect(activity).toHaveLength(0);
        expect(poolEvents).toHaveLength(0);
      }),
    );
  });

  it("property: a mixed batch decodes each event to its own round, in place", () => {
    fc.assert(
      fc.property(arbRound, arbAddress, arbU256, (roundId, user, amount) => {
        const logs = [
          encodeLog("RoundInitialized", { roundId }, 1n, 0),
          encodeLog("SetsMinted", { roundId, user, amount }, 2n, 1),
          encodeLog("ThresholdLocked", { roundId, threshold: amount }, 3n, 2),
          encodeLog("SetsMinted", { roundId: roundId + 1n, user, amount }, 4n, 3), // foreign
          encodeLog("Claimed", { roundId, user, cstOut: amount }, 5n, 4),
        ];
        const { activity } = decodeScan(logs, roundId);
        const kinds = activity.map((event) => event.kind);
        expect(kinds).toEqual(
          amount > 0n
            ? ["roundInitialized", "mint", "thresholdLocked", "claimed"]
            : ["roundInitialized", "mint", "thresholdLocked"], // zero claims are dropped
        );
      }),
    );
  });
});

describe("decodeScan: every event's feed entry", () => {
  const user = getAddress("0x4444444444444444444444444444444444444444");
  const cases: ReadonlyArray<[string, Record<string, unknown>, Record<string, unknown>]> = [
    [
      "LiquidityRemoved",
      { roundId: 7n, provider: user, sharesIn: 9n, yesOut: 5n, noOut: 8n, feesOut: 2n },
      // The larger leg is the headline amount; shares burned are secondary.
      { kind: "remove", user, amount: 8n, secondary: 9n, side: null, feeBps: null },
    ],
    [
      "LiquidityRemoved",
      { roundId: 7n, provider: user, sharesIn: 9n, yesOut: 11n, noOut: 3n, feesOut: 0n },
      { kind: "remove", amount: 11n },
    ],
    [
      "FeeDeclarationUpdated",
      { roundId: 7n, provider: user, oldFeeBps: 100, newFeeBps: 250 },
      { kind: "feeVote", user, feeBps: 250, amount: 0n, secondary: 100n },
    ],
    ["FeesClaimed", { roundId: 7n, user, amount: 42n }, { kind: "feesClaimed", user, amount: 42n, secondary: 0n }],
    ["SetsMinted", { roundId: 7n, user, amount: 6n }, { kind: "mint", user, amount: 6n }],
    ["SetsRedeemed", { roundId: 7n, user, amount: 6n }, { kind: "redeem", user, amount: 6n }],
    [
      "Resolved",
      { roundId: 7n, finalCount: 1_234n, yesWon: false },
      { kind: "resolved", user: null, amount: 0n, secondary: 1_234n, yesWon: false },
    ],
    ["Claimed", { roundId: 7n, user, cstOut: 77n }, { kind: "claimed", user, amount: 77n, yesWon: null }],
  ];

  it.each(cases)("%s → feed entry", (eventName, args, expected) => {
    const { activity } = decodeScan([encodeLog(eventName, args, 55n, 3)], 7n);
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ ...expected, blockNumber: 55n, logIndex: 3, timestamp: null });
  });

  it("replays liquidity removals into the pool history with the exact withdrawals", () => {
    const { poolEvents } = decodeScan(
      [
        encodeLog("LiquidityRemoved", {
          roundId: 7n,
          provider: user,
          sharesIn: 9n,
          yesOut: 5n,
          noOut: 8n,
          feesOut: 2n,
        }),
      ],
      7n,
    );
    expect(poolEvents).toEqual([
      expect.objectContaining({ kind: "remove", provider: user, sharesIn: 9n, yesOut: 5n, noOut: 8n, feesOut: 2n }),
    ]);
  });

  it("drops zero-value fee claims and payouts (nothing happened for the feed)", () => {
    const logs = [
      encodeLog("FeesClaimed", { roundId: 7n, user, amount: 0n }),
      encodeLog("Claimed", { roundId: 7n, user, cstOut: 0n }),
    ];
    expect(decodeScan(logs, 7n).activity).toHaveLength(0);
  });

  it("keeps the pool replay to reserve-moving events: votes, sets and payouts stay out", () => {
    const logs = [
      encodeLog("FeeDeclarationUpdated", { roundId: 7n, provider: user, oldFeeBps: 1, newFeeBps: 2 }),
      encodeLog("SetsMinted", { roundId: 7n, user, amount: 1n }),
      encodeLog("SetsRedeemed", { roundId: 7n, user, amount: 1n }),
      encodeLog("Claimed", { roundId: 7n, user, cstOut: 1n }),
    ];
    const { activity, poolEvents } = decodeScan(logs, 7n);
    expect(activity).toHaveLength(4);
    expect(poolEvents).toHaveLength(0);
  });
});
