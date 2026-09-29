"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Address, Log, PublicClient } from "viem";
import { parseEventLogs } from "viem";
import { usePublicClient, useWatchContractEvent } from "wagmi";
import { gestureSeriesMarketAbi } from "@/lib/abi/gesture-series-market";
import { appConfig } from "@/lib/config";
import type { PoolEvent } from "@/lib/history";
import type { BetSide } from "@/lib/math";

/** Any round event, normalized for the activity feed. */
export interface ActivityEvent {
  readonly kind:
    | "bet"
    | "add"
    | "remove"
    | "feeVote"
    | "feesClaimed"
    | "mint"
    | "redeem"
    | "resolved"
    | "claimed"
    | "roundInitialized"
    | "thresholdLocked";
  readonly blockNumber: bigint;
  readonly logIndex: number;
  readonly transactionHash: `0x${string}`;
  readonly user: `0x${string}` | null;
  readonly side: BetSide | null;
  /** For adds and fee votes: the declared fee (bps). */
  readonly feeBps: number | null;
  /** Primary CST-denominated amount (bet in, liquidity in/out, claim out…). */
  readonly amount: bigint;
  /** For bets: tokens received. For `resolved`: the final gesture count. */
  readonly secondary: bigint;
  /** For `resolved`: whether YES won. */
  readonly yesWon: boolean | null;
  readonly timestamp: number | null;
}

interface EventScan {
  readonly activity: ActivityEvent[];
  readonly poolEvents: PoolEvent[];
}

/** How many of the newest events get real block timestamps (1 RPC call per block). */
const TIMESTAMPED_BLOCKS = 30;

/** Decodes a raw log scan into activity + pool-replay events for one round.
 * Exported for testing: the mapping is pure and fuzz-tested. */
export function decodeScan(logs: Log[], roundId: bigint): EventScan {
  const parsed = parseEventLogs({ abi: gestureSeriesMarketAbi, logs });
  const activity: ActivityEvent[] = [];
  const poolEvents: PoolEvent[] = [];

  for (const log of parsed) {
    // Every series event carries the round as its first indexed arg.
    if (!("roundId" in log.args) || log.args.roundId !== roundId) continue;
    const base = {
      blockNumber: log.blockNumber ?? 0n,
      logIndex: log.logIndex ?? 0,
      transactionHash: (log.transactionHash ?? "0x") as `0x${string}`,
      timestamp: null,
      feeBps: null,
      side: null,
      yesWon: null,
    };
    switch (log.eventName) {
      case "Bet": {
        const side: BetSide = log.args.yes ? "yes" : "no";
        activity.push({
          ...base,
          kind: "bet",
          user: log.args.user,
          side,
          amount: log.args.cstIn,
          secondary: log.args.tokensOut,
        });
        poolEvents.push({
          kind: "bet",
          blockNumber: base.blockNumber,
          logIndex: base.logIndex,
          transactionHash: base.transactionHash,
          user: log.args.user,
          side,
          cstIn: log.args.cstIn,
          netIn: log.args.netIn,
          tokensOut: log.args.tokensOut,
          timestamp: null,
        });
        break;
      }
      case "LiquidityAdded":
        activity.push({
          ...base,
          kind: "add",
          user: log.args.provider,
          feeBps: log.args.declaredFeeBps,
          amount: log.args.cstIn,
          secondary: log.args.sharesOut,
        });
        poolEvents.push({
          kind: "add",
          blockNumber: base.blockNumber,
          logIndex: base.logIndex,
          transactionHash: base.transactionHash,
          provider: log.args.provider,
          cstIn: log.args.cstIn,
          declaredFeeBps: log.args.declaredFeeBps,
          sharesOut: log.args.sharesOut,
          yesToPool: log.args.yesToPool,
          noToPool: log.args.noToPool,
          timestamp: null,
        });
        break;
      case "LiquidityRemoved":
        activity.push({
          ...base,
          kind: "remove",
          user: log.args.provider,
          amount: log.args.yesOut > log.args.noOut ? log.args.yesOut : log.args.noOut,
          secondary: log.args.sharesIn,
        });
        poolEvents.push({
          kind: "remove",
          blockNumber: base.blockNumber,
          logIndex: base.logIndex,
          transactionHash: base.transactionHash,
          provider: log.args.provider,
          sharesIn: log.args.sharesIn,
          yesOut: log.args.yesOut,
          noOut: log.args.noOut,
          feesOut: log.args.feesOut,
          timestamp: null,
        });
        break;
      case "FeeDeclarationUpdated":
        activity.push({
          ...base,
          kind: "feeVote",
          user: log.args.provider,
          feeBps: log.args.newFeeBps,
          amount: 0n,
          secondary: BigInt(log.args.oldFeeBps),
        });
        break;
      case "FeesClaimed":
        if (log.args.amount > 0n) {
          activity.push({
            ...base,
            kind: "feesClaimed",
            user: log.args.user,
            amount: log.args.amount,
            secondary: 0n,
          });
        }
        break;
      case "SetsMinted":
        activity.push({
          ...base,
          kind: "mint",
          user: log.args.user,
          amount: log.args.amount,
          secondary: 0n,
        });
        break;
      case "SetsRedeemed":
        activity.push({
          ...base,
          kind: "redeem",
          user: log.args.user,
          amount: log.args.amount,
          secondary: 0n,
        });
        break;
      case "Resolved":
        activity.push({
          ...base,
          kind: "resolved",
          user: null,
          amount: 0n,
          secondary: log.args.finalCount,
          yesWon: log.args.yesWon,
        });
        break;
      case "Claimed":
        if (log.args.cstOut > 0n) {
          activity.push({
            ...base,
            kind: "claimed",
            user: log.args.user,
            amount: log.args.cstOut,
            secondary: 0n,
          });
        }
        break;
      case "RoundInitialized":
        activity.push({ ...base, kind: "roundInitialized", user: null, amount: 0n, secondary: 0n });
        break;
      case "ThresholdLocked":
        activity.push({
          ...base,
          kind: "thresholdLocked",
          user: null,
          amount: 0n,
          secondary: log.args.threshold,
        });
        break;
    }
  }
  return { activity, poolEvents };
}

async function scanEvents(
  client: PublicClient,
  series: Address,
  roundId: bigint,
): Promise<EventScan> {
  const fromBlock = appConfig.deployBlock ?? "earliest";
  const logs = await client.getLogs({
    address: series,
    fromBlock,
    toBlock: "latest",
  });
  const { activity, poolEvents } = decodeScan(logs, roundId);

  // Timestamp only the newest blocks — enough for a human activity feed,
  // cheap enough for public RPCs.
  const uniqueBlocks = [...new Set(activity.map((e) => e.blockNumber))].sort((a, b) =>
    a < b ? 1 : -1,
  );
  const stamped = new Map<bigint, number>();
  await Promise.all(
    uniqueBlocks.slice(0, TIMESTAMPED_BLOCKS).map(async (bn) => {
      try {
        const block = await client.getBlock({ blockNumber: bn });
        stamped.set(bn, Number(block.timestamp));
      } catch {
        // Timestamps are cosmetic; ignore failures.
      }
    }),
  );

  const withTs = <T extends { blockNumber: bigint; timestamp: number | null }>(e: T): T => ({
    ...e,
    timestamp: stamped.get(e.blockNumber) ?? null,
  });

  return {
    activity: activity.map(withTs),
    poolEvents: poolEvents.map(withTs),
  };
}

/**
 * Full event history of one round plus live updates.
 *
 * Strategy: one `eth_getLogs` scan (from the configured deploy block) cached
 * in react-query, then `watchContractEvent` invalidates the scan whenever any
 * new series event lands, so all consumers refresh together.
 */
export function useMarketEvents(series: Address | null, roundId: bigint | null) {
  const client = usePublicClient();
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => ["series-events", series, roundId?.toString()] as const,
    [series, roundId],
  );

  const query = useQuery({
    queryKey,
    enabled: series !== null && roundId !== null && !!client,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: () => scanEvents(client as PublicClient, series as Address, roundId as bigint),
  });

  useWatchContractEvent({
    address: series ?? undefined,
    abi: gestureSeriesMarketAbi,
    enabled: series !== null,
    poll: true,
    pollingInterval: 8_000,
    onLogs: () => {
      void queryClient.invalidateQueries({ queryKey: ["series-events", series] });
    },
  });

  // Newest-first for the activity feed.
  const activity = useMemo(() => {
    const list = query.data?.activity ?? [];
    return [...list].sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? 1 : -1;
      return b.logIndex - a.logIndex;
    });
  }, [query.data]);

  const poolEvents = query.data?.poolEvents ?? [];

  return { activity, poolEvents, isLoading: query.isLoading, error: query.error as Error | null };
}

/** Sum of CST wagered through bets — the round's traded volume. */
export function totalVolume(events: readonly PoolEvent[]): bigint {
  return events.reduce((acc, e) => (e.kind === "bet" ? acc + e.cstIn : acc), 0n);
}
