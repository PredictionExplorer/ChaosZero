import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";

/** Human explanations for every custom error the series market can revert with. */
const CONTRACT_ERRORS: Record<string, string> = {
  RoundNotActive:
    "This round is already over — trading and liquidity are closed for it. Withdrawals, redemptions and claims still work.",
  RoundNotInitialized: "This round's market hasn't been opened yet. Adding liquidity opens it.",
  OutcomeDecided:
    "The gesture count already crossed the threshold, so YES has won — betting and adding liquidity are closed. The round can be resolved now.",
  NotResolvable:
    "The outcome isn't known yet — either the round hasn't started, or it's live and the count hasn't crossed the threshold.",
  AlreadyResolved: "This round has already been resolved.",
  NotResolved: "This round hasn't been resolved yet — resolve it first, then claim.",
  Slippage:
    "Execution moved beyond your slippage tolerance (a price move or a fee-vote change). Try again or raise the tolerance.",
  DeadlineExpired: "The transaction took too long and expired. Please try again.",
  InsufficientLiquidity: "Not enough liquidity in the pool (or the deposit is too small).",
  InsufficientShares: "You don't hold enough shares or paired tokens for that.",
  InvalidParams: "Invalid parameters.",
  TransferFailed: "The CST token transfer failed. Check your balance and try again.",
  ReentrantCall: "The transaction was rejected by the reentrancy guard.",
};

/**
 * Maps any error thrown by a wallet/RPC interaction to a short, human-friendly
 * message. Never throws; always returns something presentable.
 */
export function describeTxError(error: unknown): string {
  if (error instanceof BaseError) {
    if (error.walk((e) => e instanceof UserRejectedRequestError)) {
      return "Transaction cancelled in your wallet.";
    }
    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName ?? revert.signature;
      if (name && CONTRACT_ERRORS[name]) return CONTRACT_ERRORS[name];
      if (name) return `Transaction reverted: ${name}`;
    }
    const short = error.shortMessage;
    if (/insufficient funds/i.test(short)) {
      return "Not enough ETH to pay for gas.";
    }
    // Some wallets surface revert names only in the message string.
    for (const [name, message] of Object.entries(CONTRACT_ERRORS)) {
      if (short.includes(name) || error.message.includes(name)) return message;
    }
    return short;
  }
  if (error instanceof Error) {
    if (/user rejected|user denied/i.test(error.message))
      return "Transaction cancelled in your wallet.";
    return error.message;
  }
  return "Something went wrong. Please try again.";
}
