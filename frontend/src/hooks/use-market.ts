"use client";

import { useMemo } from "react";
import type { Address } from "viem";
import { useConnection, useReadContract, useReadContracts } from "wagmi";
import { cosmicGameAbi } from "@/lib/abi/cosmic-game";
import { erc20Abi } from "@/lib/abi/erc20";
import { gestureSeriesMarketAbi } from "@/lib/abi/gesture-series-market";
import type { PoolTuple, RoundSnapshot, RoundStateTuple, UserSnapshot } from "@/lib/market";
import { toRoundSnapshot } from "@/lib/market";

const REFRESH_MS = 8_000;

/** The series' immutable configuration — fetched once, cached forever. */
export interface SeriesStatics {
  readonly cstAddress: Address;
  readonly gameAddress: Address;
}

export function useSeriesStatics(series: Address | null) {
  const contract = { address: series ?? undefined, abi: gestureSeriesMarketAbi } as const;
  const result = useReadContracts({
    allowFailure: false,
    contracts: [
      { ...contract, functionName: "cst" },
      { ...contract, functionName: "game" },
    ],
    query: {
      enabled: series !== null,
      staleTime: Infinity,
      gcTime: Infinity,
      retry: 3,
    },
  });

  const statics: SeriesStatics | null = useMemo(() => {
    if (!result.data) return null;
    const [cstAddress, gameAddress] = result.data;
    return { cstAddress, gameAddress };
  }, [result.data]);

  return { statics, isLoading: result.isLoading, error: result.error, refetch: result.refetch };
}

/** The game's live round counter — decides which round the app follows. */
export function useCurrentGameRound(statics: SeriesStatics | null) {
  return useReadContract({
    address: statics?.gameAddress,
    abi: cosmicGameAbi,
    functionName: "roundNum",
    query: {
      enabled: statics !== null,
      refetchInterval: REFRESH_MS,
    },
  });
}

/** Full state of one round: lifecycle flags + the pool. Polls. */
export function useRoundSnapshot(
  series: Address | null,
  statics: SeriesStatics | null,
  roundId: bigint | null,
) {
  const contract = { address: series ?? undefined, abi: gestureSeriesMarketAbi } as const;
  const gameContract = { address: statics?.gameAddress, abi: cosmicGameAbi } as const;

  const result = useReadContracts({
    allowFailure: false,
    contracts:
      roundId === null
        ? []
        : [
            { ...contract, functionName: "roundState", args: [roundId] },
            { ...contract, functionName: "pool", args: [roundId] },
            { ...gameContract, functionName: "roundNum" },
            // The previous round's live count: the FORMING threshold shown
            // while this round is still in the future.
            {
              ...gameContract,
              functionName: "bidderAddresses",
              args: [roundId === 0n ? 0n : roundId - 1n],
            },
          ],
    query: {
      enabled: series !== null && statics !== null && roundId !== null,
      refetchInterval: REFRESH_MS,
    },
  });

  const snapshot: RoundSnapshot | null = useMemo(() => {
    if (!series || !statics || roundId === null || !result.data) return null;
    const [state, poolRow, gameRoundNum, prevRoundCount] = result.data as [
      RoundStateTuple,
      PoolTuple,
      bigint,
      bigint,
    ];
    return toRoundSnapshot({
      seriesAddress: series,
      roundId,
      state,
      pool: poolRow,
      gameRoundNum,
      prevRoundCount,
      cstAddress: statics.cstAddress,
      gameAddress: statics.gameAddress,
    });
  }, [series, statics, roundId, result.data]);

  return { snapshot, isLoading: result.isLoading, error: result.error, refetch: result.refetch };
}

/** The connected user's balances, allowance and LP position for one round. */
export function useUserSnapshot(
  series: Address | null,
  statics: SeriesStatics | null,
  roundId: bigint | null,
) {
  const { address } = useConnection();
  const contract = { address: series ?? undefined, abi: gestureSeriesMarketAbi } as const;
  const cstContract = { address: statics?.cstAddress, abi: erc20Abi } as const;

  const result = useReadContracts({
    allowFailure: false,
    contracts:
      !address || roundId === null
        ? []
        : [
            { ...contract, functionName: "balancesOf", args: [roundId, address] },
            { ...contract, functionName: "lpPositionOf", args: [roundId, address] },
            { ...cstContract, functionName: "balanceOf", args: [address] },
            { ...cstContract, functionName: "allowance", args: [address, series ?? "0x"] },
          ],
    query: {
      enabled: series !== null && statics !== null && roundId !== null && !!address,
      refetchInterval: REFRESH_MS,
    },
  });

  const user: UserSnapshot | null = useMemo(() => {
    if (!result.data || !address) return null;
    const [balances, lpRow, cstBalance, cstAllowance] = result.data as [
      readonly [bigint, bigint],
      readonly [bigint, bigint, number],
      bigint,
      bigint,
    ];
    return {
      address,
      yesBalance: balances[0],
      noBalance: balances[1],
      cstBalance,
      cstAllowance,
      lpShares: lpRow[0],
      lpPendingFees: lpRow[1],
      lpDeclaredFeeBps: Number(lpRow[2]),
    };
  }, [result.data, address]);

  return { user, isLoading: result.isLoading, refetch: result.refetch };
}

export interface MarketState {
  readonly statics: SeriesStatics | null;
  readonly snapshot: RoundSnapshot | null;
  readonly user: UserSnapshot | null;
  /** The round the app is displaying (override or the game's current round). */
  readonly roundId: bigint | null;
  /** The game's live round (null until loaded). */
  readonly currentRound: bigint | null;
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly refetchAll: () => void;
}

/**
 * One-stop hook assembling the full view: series statics, the followed round
 * (live round unless `?round=` overrides), that round's snapshot, and the
 * connected user's stake in it.
 */
export function useMarket(series: Address | null, roundOverride: bigint | null): MarketState {
  const {
    statics,
    isLoading: staticsLoading,
    error: staticsError,
    refetch: refetchStatics,
  } = useSeriesStatics(series);
  const currentRound = useCurrentGameRound(statics);
  const roundId = roundOverride ?? currentRound.data ?? null;
  const {
    snapshot,
    isLoading: snapshotLoading,
    error: snapshotError,
    refetch: refetchSnapshot,
  } = useRoundSnapshot(series, statics, roundId);
  const { user, refetch: refetchUser } = useUserSnapshot(series, statics, roundId);

  return {
    statics,
    snapshot,
    user,
    roundId,
    currentRound: currentRound.data ?? null,
    isLoading: staticsLoading || currentRound.isLoading || (roundId !== null && snapshotLoading),
    error: (staticsError ?? currentRound.error ?? snapshotError) as Error | null,
    refetchAll: () => {
      void refetchStatics();
      void currentRound.refetch();
      void refetchSnapshot();
      void refetchUser();
    },
  };
}
