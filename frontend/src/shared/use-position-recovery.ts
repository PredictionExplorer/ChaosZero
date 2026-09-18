"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { useConnection, usePublicClient } from "wagmi";
import { erc20Abi } from "@/lib/abi/erc20";
import { appConfig } from "@/lib/config";
import { sharedMarketAbi } from "./abi";
import type { SharedSnapshot } from "./use-shared-market";

export interface PositionRecovery {
  owner: Address;
  roundId: bigint;
  token: Address;
  timestamp: bigint;
  collateral: bigint;
  user: NonNullable<SharedSnapshot["user"]>;
}

/** Fresh owner balances for a known cycle, independent of game and outcome-source calls. */
export function usePositionRecovery(market: Address, roundId: bigint | null, enabled: boolean) {
  const client = usePublicClient();
  const { address } = useConnection();
  return useQuery({
    queryKey: [
      "shared-market",
      "position-recovery",
      appConfig.chain.id,
      market,
      roundId?.toString() ?? null,
      address ?? null,
    ],
    enabled: enabled && !!client && !!address && roundId !== null && appConfig.chain.id === 31337,
    staleTime: 0,
    retry: false,
    refetchInterval: enabled ? 4_000 : false,
    queryFn: async (): Promise<PositionRecovery> => {
      if (!client || !address || roundId === null || appConfig.chain.id !== 31337)
        throw new Error("Choose a cycle and connect a local wallet to recover positions.");
      const block = await client.getBlock();
      const blockNumber = block.number;
      const token = await client.readContract({
        address: market,
        abi: sharedMarketAbi,
        functionName: "cst",
        blockNumber,
      });
      const [decimals, balances, balance, allowance, accounting] = await Promise.all([
        client.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "decimals",
          blockNumber,
        }),
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
        client.readContract({
          address: market,
          abi: sharedMarketAbi,
          functionName: "roundAccounting",
          args: [roundId],
          blockNumber,
        }),
      ]);
      if (decimals !== 18) throw new Error("This market requires an 18-decimal CST token.");
      return {
        owner: address,
        roundId,
        token,
        timestamp: block.timestamp,
        collateral: accounting[0],
        user: { yes: balances[0], no: balances[1], balance, allowance },
      };
    },
  });
}
