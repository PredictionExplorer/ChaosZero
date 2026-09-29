"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { Address, Hash } from "viem";
import { useConfig, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { erc20Abi } from "@/lib/abi/erc20";
import { gestureSeriesMarketAbi } from "@/lib/abi/gesture-series-market";
import { appConfig } from "@/lib/config";
import { describeTxError } from "@/lib/errors";
import type { BetSide } from "@/lib/math";

export type ActionKind =
  | "approve"
  | "bet"
  | "addLiquidity"
  | "removeLiquidity"
  | "updateFee"
  | "claimFees"
  | "mint"
  | "redeem"
  | "resolve"
  | "claim";

/** Every transaction gets this long to land before its deadline expires. */
const TX_DEADLINE_SECONDS = 15 * 60;

export interface MarketActions {
  /** Which action is currently mid-flight, if any (drives button spinners). */
  readonly pending: ActionKind | null;
  approve(cst: Address, amount: bigint): Promise<boolean>;
  bet(side: BetSide, cstIn: bigint, minTokensOut: bigint): Promise<boolean>;
  addLiquidity(
    cstIn: bigint,
    declaredFeeBps: number,
    initialYesProbBps: bigint,
    minSharesOut: bigint,
  ): Promise<boolean>;
  removeLiquidity(shares: bigint, minYesOut: bigint, minNoOut: bigint): Promise<boolean>;
  updateFeeDeclaration(newFeeBps: number): Promise<boolean>;
  claimFees(): Promise<boolean>;
  mintSets(amount: bigint): Promise<boolean>;
  redeemSets(amount: bigint): Promise<boolean>;
  resolve(): Promise<boolean>;
  claim(): Promise<boolean>;
}

function explorerTxUrl(hash: Hash): string | null {
  const base = appConfig.chain.blockExplorers?.default?.url;
  return base ? `${base.replace(/\/$/, "")}/tx/${hash}` : null;
}

function txDeadline(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + TX_DEADLINE_SECONDS);
}

/**
 * All writes to the series market (scoped to one round), wrapped in a uniform
 * submit → confirm → refresh flow with toast feedback. Every method resolves
 * `true` on confirmed success.
 */
export function useMarketActions(series: Address | null, roundId: bigint | null): MarketActions {
  const config = useConfig();
  const queryClient = useQueryClient();
  const { writeContractAsync } = useWriteContract();
  const [pending, setPending] = useState<ActionKind | null>(null);

  const run = useCallback(
    async (kind: ActionKind, label: string, write: () => Promise<Hash>): Promise<boolean> => {
      if (pending) return false;
      setPending(kind);
      const toastId = toast.loading(`${label} — confirm in your wallet…`);
      try {
        const hash = await write();
        const url = explorerTxUrl(hash);
        toast.loading(`${label} — waiting for confirmation…`, {
          id: toastId,
          ...(url ? { action: { label: "View", onClick: () => window.open(url, "_blank") } } : {}),
        });
        const receipt = await waitForTransactionReceipt(config, { hash });
        if (receipt.status !== "success") {
          toast.error(`${label} failed on-chain.`, { id: toastId });
          return false;
        }
        toast.success(`${label} confirmed.`, {
          id: toastId,
          ...(url ? { action: { label: "View", onClick: () => window.open(url, "_blank") } } : {}),
        });
        return true;
      } catch (error) {
        toast.error(describeTxError(error), { id: toastId });
        return false;
      } finally {
        setPending(null);
        // Refresh everything that could have changed: reads and event history.
        void queryClient.invalidateQueries();
      }
    },
    [config, pending, queryClient],
  );

  const approve = useCallback(
    (cst: Address, amount: bigint) =>
      run("approve", "Approving CST", () =>
        writeContractAsync({
          address: cst,
          abi: erc20Abi,
          functionName: "approve",
          args: [series as Address, amount],
        }),
      ),
    [run, writeContractAsync, series],
  );

  const bet = useCallback(
    (side: BetSide, cstIn: bigint, minTokensOut: bigint) =>
      run("bet", side === "yes" ? "Betting YES" : "Betting NO", () =>
        writeContractAsync({
          address: series as Address,
          abi: gestureSeriesMarketAbi,
          functionName: side === "yes" ? "betYes" : "betNo",
          args: [roundId as bigint, cstIn, minTokensOut, txDeadline()],
        }),
      ),
    [run, writeContractAsync, series, roundId],
  );

  const addLiquidity = useCallback(
    (cstIn: bigint, declaredFeeBps: number, initialYesProbBps: bigint, minSharesOut: bigint) =>
      run("addLiquidity", "Adding liquidity", () =>
        writeContractAsync({
          address: series as Address,
          abi: gestureSeriesMarketAbi,
          functionName: "addLiquidity",
          args: [
            roundId as bigint,
            cstIn,
            declaredFeeBps,
            initialYesProbBps,
            minSharesOut,
            txDeadline(),
          ],
        }),
      ),
    [run, writeContractAsync, series, roundId],
  );

  const removeLiquidity = useCallback(
    (shares: bigint, minYesOut: bigint, minNoOut: bigint) =>
      run("removeLiquidity", "Removing liquidity", () =>
        writeContractAsync({
          address: series as Address,
          abi: gestureSeriesMarketAbi,
          functionName: "removeLiquidity",
          args: [roundId as bigint, shares, minYesOut, minNoOut, txDeadline()],
        }),
      ),
    [run, writeContractAsync, series, roundId],
  );

  const updateFeeDeclaration = useCallback(
    (newFeeBps: number) =>
      run("updateFee", "Updating fee vote", () =>
        writeContractAsync({
          address: series as Address,
          abi: gestureSeriesMarketAbi,
          functionName: "updateFeeDeclaration",
          args: [roundId as bigint, newFeeBps],
        }),
      ),
    [run, writeContractAsync, series, roundId],
  );

  const claimFees = useCallback(
    () =>
      run("claimFees", "Claiming LP fees", () =>
        writeContractAsync({
          address: series as Address,
          abi: gestureSeriesMarketAbi,
          functionName: "claimFees",
          args: [roundId as bigint],
        }),
      ),
    [run, writeContractAsync, series, roundId],
  );

  const mintSets = useCallback(
    (amount: bigint) =>
      run("mint", "Minting sets", () =>
        writeContractAsync({
          address: series as Address,
          abi: gestureSeriesMarketAbi,
          functionName: "mintSets",
          args: [roundId as bigint, amount],
        }),
      ),
    [run, writeContractAsync, series, roundId],
  );

  const redeemSets = useCallback(
    (amount: bigint) =>
      run("redeem", "Redeeming sets", () =>
        writeContractAsync({
          address: series as Address,
          abi: gestureSeriesMarketAbi,
          functionName: "redeemSets",
          args: [roundId as bigint, amount],
        }),
      ),
    [run, writeContractAsync, series, roundId],
  );

  const resolve = useCallback(
    () =>
      run("resolve", "Resolving round", () =>
        writeContractAsync({
          address: series as Address,
          abi: gestureSeriesMarketAbi,
          functionName: "resolve",
          args: [roundId as bigint],
        }),
      ),
    [run, writeContractAsync, series, roundId],
  );

  const claim = useCallback(
    () =>
      run("claim", "Claiming winnings", () =>
        writeContractAsync({
          address: series as Address,
          abi: gestureSeriesMarketAbi,
          functionName: "claim",
          args: [roundId as bigint],
        }),
      ),
    [run, writeContractAsync, series, roundId],
  );

  return {
    pending,
    approve,
    bet,
    addLiquidity,
    removeLiquidity,
    updateFeeDeclaration,
    claimFees,
    mintSets,
    redeemSets,
    resolve,
    claim,
  };
}
