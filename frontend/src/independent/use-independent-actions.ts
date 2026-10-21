"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { createTestClient, http, type Abi, type Address, type Hash } from "viem";
import { useConnection, usePublicClient, useWriteContract } from "wagmi";
import { erc20Abi } from "@/lib/abi/erc20";
import { appConfig } from "@/lib/config";
import { COSMIC_GAME_ADDRESS } from "@/lib/contracts";
import { localGameAbi, localTokenAbi } from "@/shared/abi";
import { positionId, validateRecipient } from "@/shared/positions";
import { independentMarketAbi, independentSourceAbi } from "./abi";
import { assertProductionMarket, isMarketChain } from "./deployment";
import { describeIndependentError } from "./errors";
import {
  LOCAL_DIRECT_TRANSFER,
  type IndependentActions,
  type IndependentRecovery,
  type IndependentSnapshot,
} from "./models";

export function useIndependentActions(
  market: Address,
  snapshot: IndependentSnapshot | undefined,
  recovery?: IndependentRecovery,
): IndependentActions {
  const client = usePublicClient();
  const { address: account, chainId } = useConnection();
  const { writeContractAsync } = useWriteContract();
  const queries = useQueryClient();
  const locked = useRef(false);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const sourceSnapshot = () => {
    if (recovery)
      throw new Error(
        "Outcome data is unavailable. Only merges, transfers and already-settled claims are available.",
      );
    if (!snapshot) throw new Error("Market data unavailable.");
    if (!account) throw new Error("Connect your wallet to continue.");
    if (snapshot.market.toLowerCase() !== market.toLowerCase())
      throw new Error("The market changed. Refresh before continuing.");
    if (!snapshot.user) throw new Error("Refresh your wallet balances before continuing.");
    if (snapshot.user && snapshot.user.owner.toLowerCase() !== account?.toLowerCase())
      throw new Error("Your wallet changed. Refresh your balances before continuing.");
    return snapshot;
  };
  const owned = () => {
    if (!account) throw new Error("Connect your wallet to continue.");
    if (recovery) {
      if (
        recovery.market.toLowerCase() !== market.toLowerCase() ||
        recovery.user.owner.toLowerCase() !== account.toLowerCase()
      )
        throw new Error("Recovery balances belong to another wallet or market. Refresh positions.");
      return recovery;
    }
    return sourceSnapshot();
  };
  const write = async (parameters: {
    address: Address;
    abi: Abi;
    functionName: string;
    args?: readonly unknown[];
    value?: bigint;
  }) => {
    if (!client || !account) throw new Error("Connect your wallet to continue.");
    if (
      !isMarketChain(appConfig.chain.id) ||
      chainId !== appConfig.chain.id ||
      (await client.getChainId()) !== appConfig.chain.id
    )
      throw new Error("Switch your wallet to the configured market network.");
    if (appConfig.chain.id === 42161) {
      const [token, source] = await Promise.all([
        client.readContract({ address: market, abi: independentMarketAbi, functionName: "cst" }),
        client.readContract({ address: market, abi: independentMarketAbi, functionName: "source" }),
      ]);
      // Recovery must not depend on the source responding. Its immutable address
      // is still checked against the separately pinned production deployment.
      const game = recovery
        ? COSMIC_GAME_ADDRESS
        : await client.readContract({
            address: source,
            abi: independentSourceAbi,
            functionName: "game",
          });
      assertProductionMarket(appConfig.chain.id, token, source, game);
    }
    // Arbitrum estimates include execution and the L1 data component. Re-estimate
    // every operation; a new cycle may also settle and start all eight pools.
    const estimate = await client.estimateContractGas({ ...parameters, account });
    const gas = (estimate * 120n) / 100n;
    await client.simulateContract({ ...parameters, account, gas });
    return writeContractAsync({ ...parameters, account, chainId: Number(appConfig.chain.id), gas });
  };
  const run = async (label: string, action: () => Promise<Hash>): Promise<boolean> => {
    if (!isMarketChain(appConfig.chain.id)) {
      setMessage("This network is not supported by the market.");
      return false;
    }
    if (locked.current || !client) return false;
    locked.current = true;
    setPending(label);
    setMessage(null);
    const id = toast.loading(`${label}: confirm in your wallet…`);
    try {
      const hash = await action();
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success")
        throw new Error("The transaction did not complete. Refresh the market and try again.");
      setMessage(`${label} confirmed.`);
      toast.success(`${label} confirmed.`, { id });
      return true;
    } catch (error) {
      const text = describeIndependentError(error);
      setMessage(text);
      toast.error(text, { id });
      return false;
    } finally {
      await queries.invalidateQueries({ queryKey: ["independent"] });
      locked.current = false;
      setPending(null);
    }
  };
  return {
    pending,
    message,
    approve: (amount) =>
      run("CST approval", () =>
        write({
          address: sourceSnapshot().token,
          abi: erc20Abi,
          functionName: "approve",
          args: [market, amount],
        }),
      ),
    fund: (amount) =>
      run("Cycle funding", () => {
        const current = sourceSnapshot();
        // A zero-amount call is the separate Distribute trigger, never a gift.
        if (amount <= 0n) throw new Error("Enter a CST amount greater than zero.");
        return write({
          address: market,
          abi: independentMarketAbi,
          functionName: "fundRound",
          args: [current.roundId, amount],
        });
      }),
    distribute: () =>
      run("Pool distribution", () =>
        write({
          address: market,
          abi: independentMarketAbi,
          functionName: "fundRound",
          args: [sourceSnapshot().roundId, 0n],
        }),
      ),
    trade: (question, yes, buy, input, output) =>
      run(buy ? "Position purchase" : "Position sale", async () => {
        const current = sourceSnapshot();
        if (!client) throw new Error("Network connection unavailable.");
        const deadline = (await client.getBlock()).timestamp + 900n;
        return write({
          address: market,
          abi: independentMarketAbi,
          functionName: buy ? "buy" : "sell",
          args: [current.roundId, question, yes, input, output, deadline],
        });
      }),
    settle: () =>
      run("Cycle settlement", () =>
        write({
          address: market,
          abi: independentMarketAbi,
          functionName: "settleRound",
          args: [sourceSnapshot().roundId],
        }),
      ),
    claim: () =>
      run("Winnings retrieval", () => {
        const current = owned();
        if (recovery && !recovery.settled)
          throw new Error(
            "Settlement must be recorded before claims can be retrieved without outcome data.",
          );
        return write({
          address: market,
          abi: independentMarketAbi,
          functionName: "claimKnown",
          args: [current.roundId],
        });
      }),
    split: (question, amount) =>
      run("Complete-set split", () =>
        write({
          address: market,
          abi: independentMarketAbi,
          functionName: "splitPosition",
          args: [sourceSnapshot().roundId, question, amount],
        }),
      ),
    merge: (question, amount) =>
      run("Complete-set merge", () =>
        write({
          address: market,
          abi: independentMarketAbi,
          functionName: "mergePosition",
          args: [owned().roundId, question, amount],
        }),
      ),
    mergeAll: (amounts) =>
      run("Matched-set merge", () =>
        write({
          address: market,
          abi: independentMarketAbi,
          functionName: "mergePositions",
          args: [owned().roundId, amounts],
        }),
      ),
    transfer: (question, yes, amount, recipient) =>
      run("Position transfer", () => {
        const current = owned();
        const target = validateRecipient(recipient, account, market);
        if (!target.address) throw new Error(target.error ?? "Enter a recipient address.");
        return write({
          address: market,
          abi: independentMarketAbi,
          functionName: "safeTransferFrom",
          args: [account, target.address, positionId(current.roundId, question, yes), amount, "0x"],
        });
      }),
    local: (kind) =>
      run(
        `Local ${kind === "faucet" ? "CST faucet" : kind === "close" ? "cycle closure" : kind === "direct" ? "direct CST transfer" : `${kind.toUpperCase()} gesture`}`,
        () => {
          const current = sourceSnapshot();
          if (appConfig.chain.id !== 31337 || !current.local)
            throw new Error("Local game controls are unavailable.");
          switch (kind) {
            case "faucet":
              return write({
                address: current.token,
                abi: localTokenAbi,
                functionName: "faucet",
                args: [1000n * 10n ** 18n],
              });
            case "eth":
              return write({
                address: current.game,
                abi: localGameAbi,
                functionName: "bidEth",
                value: current.local.ethPrice,
              });
            case "cst":
              return write({
                address: current.game,
                abi: localGameAbi,
                functionName: "bidCst",
                args: [current.local.cstPrice],
              });
            case "close":
              return write({
                address: current.game,
                abi: localGameAbi,
                functionName: "closeCycle",
              });
            case "direct":
              // A plain ERC-20 transfer: no market code runs until the next
              // trade or Distribute absorbs it.
              return write({
                address: current.token,
                abi: localTokenAbi,
                functionName: "transfer",
                args: [market, LOCAL_DIRECT_TRANSFER],
              });
          }
        },
      ),
    advance: async (seconds) => {
      if (appConfig.chain.id !== 31337 || !appConfig.rpcUrl || !client || locked.current) return;
      locked.current = true;
      setPending("Advancing local time");
      try {
        if ((await client.getChainId()) !== 31337)
          throw new Error("The RPC is not the local test network.");
        const tester = createTestClient({
          chain: appConfig.chain,
          mode: "anvil",
          transport: http(appConfig.rpcUrl),
        });
        await tester.increaseTime({ seconds });
        await tester.mine({ blocks: 1 });
        setMessage("Local time advanced.");
      } catch (error) {
        setMessage(describeIndependentError(error));
      } finally {
        await queries.invalidateQueries({ queryKey: ["independent"] });
        locked.current = false;
        setPending(null);
      }
    },
  };
}
