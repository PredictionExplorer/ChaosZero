"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { useConnection, usePublicClient } from "wagmi";
import { erc20Abi } from "@/lib/abi/erc20";
import { appConfig } from "@/lib/config";
import { assertProductionMarket, isMarketChain } from "./deployment";
import { localGameAbi } from "@/shared/abi";
import {
  independentMarketAbi,
  independentSourceAbi,
  settlementVaultAbi,
  cosmicGameV3Abi,
} from "./abi";
import {
  fixedAmounts,
  heldContributions,
  type FundingPreview,
  type IndependentRecovery,
  type IndependentSnapshot,
} from "./models";

export function useIndependentMarket(market: Address, override: bigint | null) {
  const client = usePublicClient();
  const { address } = useConnection();
  return useQuery({
    queryKey: [
      "independent",
      "market",
      appConfig.chain.id,
      market,
      override?.toString() ?? null,
      address ?? null,
    ],
    enabled: !!client && isMarketChain(appConfig.chain.id),
    refetchInterval: 4_000,
    retry: false,
    queryFn: async (): Promise<IndependentSnapshot> => {
      if (!client || !isMarketChain(appConfig.chain.id))
        throw new Error("The market connection is not ready.");
      if (appConfig.chain.id === 42161 && (await client.getChainId()) !== 42161)
        throw new Error("The RPC is not Arbitrum One.");
      const block = await client.getBlock();
      const blockNumber = block.number;
      const [token, source, vault, poolCustody, pendingCarry] = await Promise.all([
        client.readContract({
          address: market,
          abi: independentMarketAbi,
          functionName: "cst",
          blockNumber,
        }),
        client.readContract({
          address: market,
          abi: independentMarketAbi,
          functionName: "source",
          blockNumber,
        }),
        client.readContract({
          address: market,
          abi: independentMarketAbi,
          functionName: "settlementVault",
          blockNumber,
        }),
        client.readContract({
          address: market,
          abi: independentMarketAbi,
          functionName: "totalActiveCollateral",
          blockNumber,
        }),
        client.readContract({
          address: market,
          abi: independentMarketAbi,
          functionName: "pendingCarry",
          blockNumber,
        }),
      ]);
      const [game, decimals, claimEscrow, marketBalance] = await Promise.all([
        client.readContract({
          address: source,
          abi: independentSourceAbi,
          functionName: "game",
          blockNumber,
        }),
        client.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "decimals",
          blockNumber,
        }),
        client.readContract({
          address: vault,
          abi: settlementVaultAbi,
          functionName: "totalEscrowed",
          blockNumber,
        }),
        // Same block as the custody reads, so held CST is exact rather than racy.
        client.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [market],
          blockNumber,
        }),
      ]);
      assertProductionMarket(appConfig.chain.id, token, source, game);
      if (decimals !== 18) throw new Error("This market requires an 18-decimal CST token.");
      const currentRound = await client.readContract({
        address: game,
        abi: cosmicGameV3Abi,
        functionName: "roundNum",
        blockNumber,
      });
      const roundId = override ?? currentRound;
      const round = await client.readContract({
        address: market,
        abi: independentMarketAbi,
        functionName: "roundState",
        args: [roundId],
        blockNumber,
      });
      const [states, sourceState, wallet, local, metrics] = await Promise.all([
        client.readContract({
          address: market,
          abi: independentMarketAbi,
          functionName: "questionStates",
          args: [roundId],
          blockNumber,
        }),
        round.settled
          ? null
          : client.readContract({
              address: source,
              abi: independentSourceAbi,
              functionName: "outcomeState",
              args: [roundId],
              blockNumber,
            }),
        address
          ? Promise.all([
              client.readContract({
                address: market,
                abi: independentMarketAbi,
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
        appConfig.chain.id === 42161
          ? Promise.all([
              client.readContract({
                address: source,
                abi: independentSourceAbi,
                functionName: "metrics",
                args: [roundId],
                blockNumber,
              }),
              roundId > 0n
                ? client.readContract({
                    address: source,
                    abi: independentSourceAbi,
                    functionName: "metrics",
                    args: [roundId - 1n],
                    blockNumber,
                  })
                : null,
            ])
          : null,
      ]);
      const open = sourceState ? sourceState[0] : false;
      const finalized = sourceState ? sourceState[1] : round.finalized;
      const knownMask = sourceState ? sourceState[2] : round.knownMask;
      const values = sourceState ? sourceState[3] : round.values;
      if (
        (values & ~knownMask) !== 0 ||
        (knownMask & round.knownMask) !== round.knownMask ||
        ((values ^ round.values) & round.knownMask) !== 0 ||
        (round.closed && open) ||
        (round.finalized && !finalized) ||
        (finalized && (open || knownMask !== 255)) ||
        (round.settled && (!finalized || !round.closed))
      )
        throw new Error("The outcome source returned an inconsistent state.");
      const funding =
        open && !finalized
          ? await client.readContract({
              address: market,
              abi: independentMarketAbi,
              functionName: "fundingPreview",
              args: [roundId, 0n],
              blockNumber,
            })
          : null;
      const held = heldContributions(marketBalance, poolCustody, pendingCarry);
      // The preview measures the same saturating surplus at the same block.
      if (funding && funding.unallocated !== held)
        throw new Error("The market's CST custody is inconsistent.");
      const questions = states.map((state) => {
        const initialYesBps = round.initialized ? state.initialYesBps : 5000;
        if (
          initialYesBps < 1 ||
          initialYesBps > 9999 ||
          (round.settled && state.activeCollateral !== 0n)
        )
          throw new Error("The question accounting is inconsistent.");
        return {
          pool: {
            collateral: state.activeCollateral,
            yes: state.yesSupply,
            no: state.noSupply,
            initialYesBps,
          },
          funded: round.funded,
          escrowRemaining: state.escrowRemaining,
        };
      });
      return {
        market,
        token,
        source,
        game,
        vault,
        roundId,
        currentRound,
        timestamp: block.timestamp,
        open,
        finalized,
        settled: round.settled,
        funded: round.funded,
        values,
        observedMask: knownMask,
        observedValues: values,
        questions,
        poolCustody,
        claimEscrow,
        pendingCarry,
        availableCarry: funding?.availableCarry ?? pendingCarry,
        heldContributions: held,
        funding: funding ? { ...funding, allocations: fixedAmounts(funding.allocations) } : null,
        user:
          wallet && address
            ? {
                owner: address,
                yes: fixedAmounts(wallet[0][0]),
                no: fixedAmounts(wallet[0][1]),
                balance: wallet[1],
                allowance: wallet[2],
              }
            : null,
        metrics: metrics
          ? {
              current: metrics[0].supported ? metrics[0] : null,
              previous: metrics[1]?.supported ? metrics[1] : null,
            }
          : undefined,
        local: local
          ? {
              ethPrice: local[0],
              cstPrice: local[1],
              deadline: local[2],
              current: local[3],
              previous: local[4],
            }
          : null,
      };
    },
  });
}

export function useIndependentFundingPreview(
  market: Address,
  roundId: bigint,
  amount: bigint | null,
  enabled: boolean,
) {
  const client = usePublicClient();
  return useQuery({
    queryKey: ["independent", "funding", market, roundId.toString(), amount?.toString() ?? null],
    enabled:
      enabled &&
      !!client &&
      amount !== null &&
      amount >= 0n &&
      amount < 1n << 256n &&
      isMarketChain(appConfig.chain.id),
    staleTime: 0,
    retry: false,
    refetchInterval: enabled ? 4_000 : false,
    queryFn: async (): Promise<FundingPreview> => {
      if (!client || amount === null || amount < 0n || !isMarketChain(appConfig.chain.id))
        throw new Error("Funding preview unavailable.");
      if (appConfig.chain.id === 42161 && (await client.getChainId()) !== 42161)
        throw new Error("The RPC is not Arbitrum One.");
      const block = await client.getBlock();
      const preview = await client.readContract({
        address: market,
        abi: independentMarketAbi,
        functionName: "fundingPreview",
        args: [roundId, amount],
        blockNumber: block.number,
      });
      return { ...preview, allocations: fixedAmounts(preview.allocations) };
    },
  });
}

export function useIndependentRecovery(market: Address, roundId: bigint | null, enabled: boolean) {
  const client = usePublicClient();
  const { address } = useConnection();
  return useQuery({
    queryKey: ["independent", "recovery", market, roundId?.toString() ?? null, address ?? null],
    enabled:
      enabled && !!client && !!address && roundId !== null && isMarketChain(appConfig.chain.id),
    staleTime: 0,
    retry: false,
    refetchInterval: enabled ? 4_000 : false,
    queryFn: async (): Promise<IndependentRecovery> => {
      if (!client || !address || roundId === null || !isMarketChain(appConfig.chain.id))
        throw new Error("Choose a cycle and connect your wallet first.");
      if (appConfig.chain.id === 42161 && (await client.getChainId()) !== 42161)
        throw new Error("The RPC is not Arbitrum One.");
      const block = await client.getBlock();
      const blockNumber = block.number;
      const [token, vault, round, states, balances] = await Promise.all([
        client.readContract({
          address: market,
          abi: independentMarketAbi,
          functionName: "cst",
          blockNumber,
        }),
        client.readContract({
          address: market,
          abi: independentMarketAbi,
          functionName: "settlementVault",
          blockNumber,
        }),
        client.readContract({
          address: market,
          abi: independentMarketAbi,
          functionName: "roundState",
          args: [roundId],
          blockNumber,
        }),
        client.readContract({
          address: market,
          abi: independentMarketAbi,
          functionName: "questionStates",
          args: [roundId],
          blockNumber,
        }),
        client.readContract({
          address: market,
          abi: independentMarketAbi,
          functionName: "balancesOf",
          args: [roundId, address],
          blockNumber,
        }),
      ]);
      const [decimals, balance, allowance] = await Promise.all([
        client.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "decimals",
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
      ]);
      if (decimals !== 18 || (round.settled && (!round.finalized || round.knownMask !== 255)))
        throw new Error("Position recovery accounting is inconsistent.");
      return {
        market,
        token,
        vault,
        roundId,
        timestamp: block.timestamp,
        settled: round.settled,
        values: round.values,
        questions: states.map((state) => ({
          pool: {
            collateral: state.activeCollateral,
            yes: state.yesSupply,
            no: state.noSupply,
            initialYesBps: state.initialYesBps,
          },
          funded: round.funded,
          escrowRemaining: state.escrowRemaining,
        })),
        user: {
          owner: address,
          yes: fixedAmounts(balances[0]),
          no: fixedAmounts(balances[1]),
          balance,
          allowance,
        },
      };
    },
  });
}
