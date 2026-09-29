import type { AbiEvent, Address, Hash, Log } from "viem";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { gestureSeriesMarketAbi } from "@/lib/abi/gesture-series-market";
import { SERIES } from "./fixtures";

export const LOG_TX: Hash = `0x${"ab".repeat(32)}`;
export const LOG_BLOCK_HASH: Hash = `0x${"cd".repeat(32)}`;

/**
 * Encodes a REAL log for any series-market event, exactly as a node would
 * emit it (indexed args as topics, the rest ABI-encoded as data), so decoding
 * tests exercise the production ABI rather than hand-built objects.
 */
export function encodeLog(
  eventName: string,
  args: Record<string, unknown>,
  blockNumber = 100n,
  logIndex = 0,
  address: Address = SERIES,
): Log {
  const item = gestureSeriesMarketAbi.find(
    (entry): entry is Extract<(typeof gestureSeriesMarketAbi)[number], { type: "event" }> =>
      entry.type === "event" && entry.name === eventName,
  );
  if (!item) throw new Error(`no such event: ${eventName}`);
  const topics = encodeEventTopics({
    abi: [item as AbiEvent],
    eventName,
    args,
  } as Parameters<typeof encodeEventTopics>[0]);
  const nonIndexed = item.inputs.filter((input) => !input.indexed);
  const data = encodeAbiParameters(
    nonIndexed,
    nonIndexed.map((input) => args[input.name as string]),
  );
  return {
    address,
    topics,
    data,
    blockNumber,
    logIndex,
    transactionHash: LOG_TX,
    transactionIndex: 0,
    blockHash: LOG_BLOCK_HASH,
    removed: false,
  } as Log;
}
