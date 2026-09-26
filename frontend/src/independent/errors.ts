import { BaseError, ContractFunctionRevertedError } from "viem";
import { describeSharedError } from "@/shared/errors";

const messages: Record<string, string> = {
  RoundNotOpen:
    "This cycle is closed for trading, splitting and funding. Owned pairs can still be merged.",
  NotFinalized:
    "The preceding cycle has not fully closed, so it cannot be settled yet. Opening the next cycle’s pools, settlement and winnings wait for full closure.",
  OutOfOrderRound: "A later cycle has already opened its pools. Choose the current cycle.",
  FundingCapacity:
    "This gift does not fit after carried funds are included. Refresh the funding preview and reduce the amount.",
  NotInitialized: "No pool funding or split positions exist for this cycle yet.",
  NotFunded:
    "This cycle’s pools have not opened and nothing waiting can open them yet. Add CST to all eight pools to open them.",
  InvalidParameters:
    "Nothing is waiting to enter the pools, or the amount is outside the supported range. Refresh the market.",
  InvalidTimestamp:
    "The game’s canonical cycle timestamps could not be verified. Settlement, and opening the next cycle’s pools, are unavailable until valid data returns.",
  InvalidSourceState:
    "The outcome source returned inconsistent answers. Trading, settlement and opening pools are unavailable until valid source data is restored.",
  TransferFailed:
    "A CST transfer failed. Check your CST balance and approval. A trade that opens a new cycle also settles the preceding one, which can fail here; try again later.",
  NonPositiveReserve:
    "This question has no remaining trading reserve. Use a smaller amount or fund its cycle.",
  InvalidCollateral: "The amount is outside this question’s supported collateral range.",
  InvalidProbability: "The market returned an unsupported starting price. Refresh before trading.",
};
export function describeIndependentError(error: unknown): string {
  if (error instanceof BaseError) {
    const reverted = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
    if (
      reverted instanceof ContractFunctionRevertedError &&
      reverted.data?.errorName &&
      messages[reverted.data.errorName]
    )
      return messages[reverted.data.errorName];
  }
  if (error instanceof Error)
    for (const [name, message] of Object.entries(messages))
      if (new RegExp(`\\b${name}\\b`).test(error.message)) return message;
  return describeSharedError(error);
}
