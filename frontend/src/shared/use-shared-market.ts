"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { createTestClient, http, type Abi, type Address, type Hash } from "viem";
import { useConnection, usePublicClient, useWriteContract } from "wagmi";
import { erc20Abi } from "@/lib/abi/erc20";
import { appConfig } from "@/lib/config";
import { describeSharedError } from "./errors";
import { localGameAbi, localTokenAbi, outcomeSourceAbi, sharedMarketAbi } from "./abi";
import type { SharedPool } from "./math";
import { positionId, validateRecipient, type PositionAmounts } from "./positions";
import type { PositionRecovery } from "./use-position-recovery";

// Local-only ceilings: the joint invariant traverses up to256 endings; game
// rewards can take a more expensive path when the mined timestamp advances.
// Both remain below the launcher's32M block cap; unused gas is not consumed.
const TRADE_GAS_LIMIT = 24_000_000n;
const LOCAL_GAS_LIMIT = 2_000_000n;

export interface CycleStats {
  gestureCount: bigint;
  ethSpent: bigint;
  cstBurned: bigint;
  highestCstPaid: bigint;
  enduranceDuration: bigint;
  chronoDuration: bigint;
  enduranceGesture: bigint;
  chronoGesture: bigint;
  firstGestureTime: bigint;
  lastGestureTime: bigint;
  finalized: boolean;
}

export interface SharedSnapshot {
  roundId: bigint;
  currentRound: bigint;
  timestamp: bigint;
  token: Address;
  source: Address;
  game: Address;
  funded: boolean;
  open: boolean;
  finalized: boolean;
  pool: SharedPool;
  user: {
    yes: readonly bigint[];
    no: readonly bigint[];
    balance: bigint;
    allowance: bigint;
  } | null;
  local: {
    ethPrice: bigint;
    cstPrice: bigint;
    deadline: bigint;
    current: CycleStats;
    previous: CycleStats | null;
  } | null;
}

export function useSharedMarket(market: Address, roundOverride: bigint | null) {
  const client = usePublicClient();
  const { address } = useConnection();
  return useQuery({
    queryKey: [
      "shared-market",
      appConfig.chain.id,
      market,
      address ?? null,
      roundOverride?.toString() ?? null,
    ],
    enabled: !!client,
    refetchInterval: 4_000,
    queryFn: async (): Promise<SharedSnapshot> => {
      if (!client) throw new Error("The network connection is not ready.");
      const block = await client.getBlock();
      const blockNumber = block.number;
      const [token, source] = await Promise.all([
        client.readContract({
          address: market,
          abi: sharedMarketAbi,
          functionName: "cst",
          blockNumber,
        }),
        client.readContract({
          address: market,
          abi: sharedMarketAbi,
          functionName: "source",
          blockNumber,
        }),
      ]);
      const [game, decimals] = await Promise.all([
        client.readContract({
          address: source,
          abi: outcomeSourceAbi,
          functionName: "game",
          blockNumber,
        }),
        client.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "decimals",
          blockNumber,
        }),
      ]);
      if (decimals !== 18) throw new Error("This market requires an 18-decimal CST token.");
      const currentRound = await client.readContract({
        address: game,
        abi: localGameAbi,
        functionName: "roundNum",
        blockNumber,
      });
      const roundId = roundOverride ?? currentRound;
      const [accounting, liabilities, state, userReads, localReads] = await Promise.all([
        client.readContract({
          address: market,
          abi: sharedMarketAbi,
          functionName: "roundAccounting",
          args: [roundId],
          blockNumber,
        }),
        client.readContract({
          address: market,
          abi: sharedMarketAbi,
          functionName: "liabilities",
          args: [roundId],
          blockNumber,
        }),
        client.readContract({
          address: source,
          abi: outcomeSourceAbi,
          functionName: "outcomeState",
          args: [roundId],
          blockNumber,
        }),
        address
          ? Promise.all([
              client.readContract({
                address: market,
                abi: sharedMarketAbi,
                functionName: "balancesOf",
                args: [roundId, address],
                blockNumber,
              }),
              client.readContract({
                address: token,
                abi: erc20Abi,
                functionName: "balanceOf",
                args: [address],
                blockNumber,
              }),
              client.readContract({
                address: token,
                abi: erc20Abi,
                functionName: "allowance",
                args: [address, market],
                blockNumber,
              }),
            ])
          : null,
        appConfig.chain.id === 31337
          ? Promise.all([
              client.readContract({
                address: game,
                abi: localGameAbi,
                functionName: "getNextEthPrice",
                blockNumber,
              }),
              client.readContract({
                address: game,
                abi: localGameAbi,
                functionName: "getNextCstPrice",
                blockNumber,
              }),
              client.readContract({
                address: game,
                abi: localGameAbi,
                functionName: "mainPrizeTime",
                blockNumber,
              }),
              client.readContract({
                address: game,
                abi: localGameAbi,
                functionName: "roundStats",
                args: [roundId],
                blockNumber,
              }),
              roundId > 0n
                ? client.readContract({
                    address: game,
                    abi: localGameAbi,
                    functionName: "roundStats",
                    args: [roundId - 1n],
                    blockNumber,
                  })
                : null,
            ])
          : null,
      ]);
      const [collateral, funded, cachedMask, cachedValues] = accounting;
      const [open, finalized, knownMask, values] = state;
      if (
        (values & ~knownMask) !== 0 ||
        (knownMask & cachedMask) !== cachedMask ||
        ((values ^ cachedValues) & cachedMask) !== 0 ||
        (finalized && (open || knownMask !== 255))
      )
        throw new Error("The outcome source returned an inconsistent state.");
      return {
        roundId,
        currentRound,
        timestamp: block.timestamp,
        token,
        source,
        game,
        funded,
        open,
        finalized,
        pool: { collateral, yes: liabilities[0], no: liabilities[1], knownMask, values },
        user: userReads
          ? {
              yes: userReads[0][0],
              no: userReads[0][1],
              balance: userReads[1],
              allowance: userReads[2],
            }
          : null,
        local: localReads
          ? {
              ethPrice: localReads[0],
              cstPrice: localReads[1],
              deadline: localReads[2],
              current: localReads[3],
              previous: localReads[4],
            }
          : null,
      };
    },
  });
}

export function useSharedActions(
  market: Address,
  snapshot: SharedSnapshot | undefined,
  recovery?: PositionRecovery,
) {
  const publicClient = usePublicClient();
  const { writeContractAsync: submitContract } = useWriteContract();
  const { address: account, chainId: walletChainId } = useConnection();
  const writeContractAsync = async (parameters: {
    address: Address;
    abi: Abi;
    functionName: string;
    args?: readonly unknown[];
    gas: bigint;
    value?: bigint;
  }) => {
    if (!publicClient || !account) throw new Error("Connect your wallet to continue.");
    if (walletChainId !== 31337)
      throw new Error("Switch your wallet to the local test network to continue.");
    if ((await publicClient.getChainId()) !== 31337)
      throw new Error("The configured RPC is not the local test network.");
    // Decode a failed preflight before opening the wallet. The explicit local
    // gas ceiling still covers timestamp-dependent work in the mined block.
    await publicClient.simulateContract({ ...parameters, account });
    return submitContract({ ...parameters, chainId: appConfig.chain.id, account });
  };
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const locked = useRef(false);
  const run = useCallback(
    async (label: string, action: () => Promise<Hash>): Promise<boolean> => {
      if (appConfig.chain.id !== 31337) {
        setMessage("This prototype only allows transactions on the local test network.");
        return false;
      }
      if (locked.current || !publicClient) return false;
      locked.current = true;
      setPending(label);
      setMessage(null);
      const id = toast.loading(`${label}: confirm in your wallet…`);
      try {
        const hash = await action();
        toast.loading(`${label}: waiting for confirmation…`, { id });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success")
          throw new Error(
            "The on-chain state changed before this transaction completed. Refresh and try again; no action was completed.",
          );
        const result = `${label} confirmed.`;
        setMessage(result);
        toast.success(result, { id });
        return true;
      } catch (error) {
        const result = describeSharedError(error);
        setMessage(result);
        toast.error(result, { id });
        return false;
      } finally {
        await queryClient.invalidateQueries({ queryKey: ["shared-market"] });
        locked.current = false;
        setPending(null);
      }
    },
    [publicClient, queryClient],
  );

  const deadline = async () => {
    if (!publicClient) throw new Error("Network connection unavailable");
    return (await publicClient.getBlock()).timestamp + 900n;
  };
  const required = () => {
    if (recovery)
      throw new Error(
        "Outcome data is unavailable. Only merges and owner transfers are available.",
      );
    if (!snapshot) throw new Error("Market data unavailable");
    return snapshot;
  };
  const positionRound = () => {
    if (recovery) {
      if (!account) throw new Error("Connect your wallet to continue.");
      if (recovery.owner.toLowerCase() !== account.toLowerCase())
        throw new Error("Recovery balances belong to a different wallet. Refresh your positions.");
      return recovery.roundId;
    }
    return required().roundId;
  };
  return {
    pending,
    message,
    split: (question: number, amount: bigint) =>
      run("Complete-set split", () =>
        writeContractAsync({
          address: market,
          abi: sharedMarketAbi,
          functionName: "splitPosition",
          gas: LOCAL_GAS_LIMIT,
          args: [required().roundId, question, amount],
        }),
      ),
    merge: (question: number, amount: bigint) =>
      run("Complete-set merge", () =>
        writeContractAsync({
          address: market,
          abi: sharedMarketAbi,
          functionName: "mergePosition",
          gas: LOCAL_GAS_LIMIT,
          args: [positionRound(), question, amount],
        }),
      ),
    mergeAll: (amounts: PositionAmounts) =>
      run("Matched-set merge", () =>
        writeContractAsync({
          address: market,
          abi: sharedMarketAbi,
          functionName: "mergePositions",
          gas: LOCAL_GAS_LIMIT,
          args: [positionRound(), amounts],
        }),
      ),
    transfer: (question: number, yes: boolean, amount: bigint, recipient: string) =>
      run("Position transfer", () => {
        if (!account) throw new Error("Connect your wallet to continue.");
        const target = validateRecipient(recipient, account, market);
        if (!target.address) throw new Error(target.error ?? "Enter a recipient address.");
        return writeContractAsync({
          address: market,
          abi: sharedMarketAbi,
          functionName: "safeTransferFrom",
          gas: LOCAL_GAS_LIMIT,
          args: [account, target.address, positionId(positionRound(), question, yes), amount, "0x"],
        });
      }),
    approve: (amount: bigint) =>
      run("CST approval", () =>
        writeContractAsync({
          address: required().token,
          abi: erc20Abi,
          functionName: "approve",
          gas: LOCAL_GAS_LIMIT,
          args: [market, amount],
        }),
      ),
    fund: (amount: bigint) =>
      run("Pool gift", () =>
        writeContractAsync({
          address: market,
          abi: sharedMarketAbi,
          functionName: "fundRound",
          gas: LOCAL_GAS_LIMIT,
          args: [required().roundId, amount],
        }),
      ),
    trade: (question: number, yes: boolean, buy: boolean, input: bigint, output: bigint) =>
      run(buy ? "Position purchase" : "Position sale", async () => {
        const args = [required().roundId, question, yes, input, output, await deadline()] as const;
        return buy
          ? writeContractAsync({
              address: market,
              abi: sharedMarketAbi,
              functionName: "buy",
              gas: TRADE_GAS_LIMIT,
              args,
            })
          : writeContractAsync({
              address: market,
              abi: sharedMarketAbi,
              functionName: "sell",
              gas: TRADE_GAS_LIMIT,
              args,
            });
      }),
    claim: () =>
      run("Retrieval", () =>
        writeContractAsync({
          address: market,
          abi: sharedMarketAbi,
          functionName: "claimKnown",
          gas: LOCAL_GAS_LIMIT,
          args: [required().roundId],
        }),
      ),
    rollover: () =>
      run("Pool rollover", () =>
        writeContractAsync({
          address: market,
          abi: sharedMarketAbi,
          functionName: "rollover",
          gas: LOCAL_GAS_LIMIT,
          args: [required().roundId, required().currentRound],
        }),
      ),
    local: (kind: "faucet" | "eth" | "cst" | "close") =>
      run(
        `Local ${kind === "faucet" ? "CST faucet" : kind === "close" ? "cycle closure" : `${kind.toUpperCase()} gesture`}`,
        async () => {
          const current = required();
          if (appConfig.chain.id !== 31337 || !current.local)
            throw new Error("Local controls are unavailable on this network.");
          switch (kind) {
            case "faucet":
              return writeContractAsync({
                address: current.token,
                abi: localTokenAbi,
                functionName: "faucet",
                gas: LOCAL_GAS_LIMIT,
                args: [1_000n * 10n ** 18n],
              });
            case "eth":
              return writeContractAsync({
                address: current.game,
                abi: localGameAbi,
                functionName: "bidEth",
                gas: LOCAL_GAS_LIMIT,
                value: current.local.ethPrice,
              });
            case "cst":
              return writeContractAsync({
                address: current.game,
                abi: localGameAbi,
                functionName: "bidCst",
                gas: LOCAL_GAS_LIMIT,
                args: [current.local.cstPrice],
              });
            case "close":
              return writeContractAsync({
                address: current.game,
                abi: localGameAbi,
                functionName: "closeCycle",
                gas: LOCAL_GAS_LIMIT,
              });
          }
        },
      ),
    advance: async (seconds: number) => {
      if (appConfig.chain.id !== 31337 || !appConfig.rpcUrl || locked.current) return;
      locked.current = true;
      setPending("Advancing local time");
      try {
        if (!publicClient || (await publicClient.getChainId()) !== 31337)
          throw new Error("The configured RPC is not the local test network.");
        const client = createTestClient({
          chain: appConfig.chain,
          mode: "anvil",
          transport: http(appConfig.rpcUrl),
        });
        await client.increaseTime({ seconds });
        await client.mine({ blocks: 1 });
        setMessage("Local time advanced.");
      } catch (error) {
        setMessage(describeSharedError(error));
      } finally {
        await queryClient.invalidateQueries({ queryKey: ["shared-market"] });
        locked.current = false;
        setPending(null);
      }
    },
  };
}
