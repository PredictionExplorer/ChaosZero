import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";
import { describeTxError } from "@/lib/errors";

const SHARED_ERRORS: Record<string, string> = {
  AnswerKnown:
    "This answer is already known. Refresh the market and retrieve any winning position.",
  ProductWouldDecrease:
    "The exact quote no longer passes the pool’s pricing check. Refresh and request a new quote, or try a larger amount for a very small trade.",
  InvalidSourceState:
    "The outcome source returned inconsistent answers. Trading is unavailable until valid source data is restored.",
  Insolvent: "This trade exceeds the pool’s available capacity. Refresh and try a smaller amount.",
  RoundNotOpen:
    "Trading and funding are closed for this cycle. Known winnings can still be retrieved.",
  DeadlineExpired:
    "This quote expired before the transaction completed. Refresh and request a new quote.",
  NotFunded: "This cycle needs its first pool gift before trading can begin.",
  InsufficientPosition:
    "There are not enough units in this position to sell. Refresh your balances.",
  NotFinalized: "The cycle must close before remaining sponsor funds can roll forward.",
  InvalidParameters:
    "The amount or cycle is outside the supported range. Check the amount and refresh the market.",
  InsufficientAllowance: "Approve enough CST for this action, then try again.",
  InsufficientBalance: "There is not enough CST in your wallet for this action.",
  TransferFailed: "The CST transfer failed. Check your CST balance and approval, then try again.",
  ReentrantCall:
    "The contract rejected a nested transaction. Wait for the current action to finish.",
  NotReady:
    "The local cycle is not ready to close. Wait for the timer; only the last participant can close before the retrieval timeout.",
  FirstGestureMustBeEth: "Start this local cycle with an ETH gesture before using CST.",
  InvalidPayment: "The gesture price changed. Refresh the local game and try again.",
  LocalChainOnly: "This prototype only supports the local test network.",
};

/** Decode shared/local errors without borrowing the legacy market's different settlement rules. */
export function describeSharedError(error: unknown): string {
  if (error instanceof BaseError) {
    if (error.walk((cause) => cause instanceof UserRejectedRequestError))
      return "Transaction cancelled in your wallet.";
    const cause = error.walk((item) => item instanceof ContractFunctionRevertedError);
    if (cause instanceof ContractFunctionRevertedError) {
      const name = cause.data?.errorName;
      if (name && SHARED_ERRORS[name]) return SHARED_ERRORS[name];
    }
  }
  if (error instanceof Error) {
    for (const [name, message] of Object.entries(SHARED_ERRORS)) {
      if (new RegExp(`\\b${name}\\b`).test(error.message)) return message;
    }
  }
  return describeTxError(error);
}
