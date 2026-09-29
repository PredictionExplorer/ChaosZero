import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";
import { describeTxError } from "@/lib/errors";

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
/**
 * Errors shared with ERC-1155 positions, CST and the local game. Consulted after
 * the market-specific messages, so those always take precedence. There is no
 * "answer already known" message: a known answer never stops trading.
 */
const COMMON: Record<string, string> = {
  ERC1155InsufficientBalance:
    "There are not enough position units for this action. Refresh your balances.",
  ERC1155InvalidReceiver:
    "The recipient cannot accept these position tokens. Check the address and receiving-contract support.",
  ERC1155InvalidSender: "The position sender is invalid. Reconnect your wallet and try again.",
  ERC1155MissingApprovalForAll: "The connected wallet is not authorized to move these positions.",
  ERC1155InvalidArrayLength: "The batch position amounts do not match. Refresh and try again.",
  ProductWouldDecrease:
    "The exact quote no longer passes the pool’s pricing check. Refresh and request a new quote, or try a larger amount for a very small trade.",
  DeadlineExpired:
    "This quote expired before the transaction completed. Refresh and request a new quote.",
  InsufficientPosition:
    "There are not enough units in this position to sell. Refresh your balances.",
  InsufficientAllowance: "Approve enough CST for this action, then try again.",
  InsufficientBalance: "There is not enough CST in your wallet for this action.",
  ReentrantCall:
    "The contract rejected a nested transaction. Wait for the current action to finish.",
  NotReady:
    "The local cycle is not ready to close. Wait for the timer; only the last participant can close before the retrieval timeout.",
  FirstGestureMustBeEth: "Start this local cycle with an ETH gesture before using CST.",
  InvalidPayment: "The gesture price changed. Refresh the local game and try again.",
  LocalChainOnly: "This prototype only supports the local test network.",
};

function lookup(table: Record<string, string>, error: unknown): string | null {
  if (error instanceof BaseError) {
    const reverted = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
    const name =
      reverted instanceof ContractFunctionRevertedError ? reverted.data?.errorName : undefined;
    if (name && table[name]) return table[name];
  }
  if (error instanceof Error)
    for (const [name, message] of Object.entries(table))
      if (new RegExp(`\\b${name}\\b`).test(error.message)) return message;
  return null;
}

export function describeIndependentError(error: unknown): string {
  if (
    error instanceof BaseError &&
    error.walk((cause) => cause instanceof UserRejectedRequestError)
  )
    return "Transaction cancelled in your wallet.";
  return lookup(messages, error) ?? lookup(COMMON, error) ?? describeTxError(error);
}
