import { BaseError, ContractFunctionRevertedError } from "viem";
import { describeSharedError } from "@/shared/errors";

const messages: Record<string, string> = {
  RoundNotOpen:
    "This cycle is closed for trading, splitting and funding. Owned pairs can still be merged.",
  NotFinalized:
    "The cycle has not closed yet. Trading continues; winnings become retrievable after full closure.",
  OutOfOrderRound: "A later cycle has already been funded. Choose the current cycle.",
  FundingCapacity:
    "This funding does not fit after carried funds are included. Refresh the funding preview and reduce new CST.",
  NotInitialized: "No pool funding or split positions exist for this cycle yet.",
  NotFunded: "Start the eight pools with carried funds or a new gift before trading.",
  InvalidTimestamp:
    "The game’s canonical cycle timestamps could not be verified. Settlement is unavailable until valid data returns.",
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
