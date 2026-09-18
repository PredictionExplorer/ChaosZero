import { parseAbi } from "viem";

export const sharedMarketAbi = parseAbi([
  "function cst() view returns (address)",
  "function source() view returns (address)",
  "function roundAccounting(uint256 roundId) view returns (uint256 collateral,bool funded,uint8 knownMask,uint8 values)",
  "function liabilities(uint256 roundId) view returns (uint256[8] yes,uint256[8] no)",
  "function balancesOf(uint256 roundId,address user) view returns (uint256[8] yes,uint256[8] no)",
  "function fundRound(uint256 roundId,uint256 amount)",
  "function buy(uint256 roundId,uint8 question,bool yes,uint256 cstIn,uint256 tokensOut,uint256 deadline)",
  "function sell(uint256 roundId,uint8 question,bool yes,uint256 tokensIn,uint256 cstOut,uint256 deadline)",
  "function claimKnown(uint256 roundId) returns (uint256 amount)",
  "function rollover(uint256 fromRound,uint256 toRound) returns (uint256 amount)",
  "error InvalidParameters()",
  "error RoundNotOpen()",
  "error NotFunded()",
  "error AnswerKnown()",
  "error InvalidSourceState()",
  "error NotFinalized()",
  "error DeadlineExpired()",
  "error InsufficientPosition()",
  "error Insolvent()",
  "error ProductWouldDecrease()",
  "error TransferFailed()",
  "error ReentrantCall()",
  "error InsufficientAllowance()",
  "error InsufficientBalance()",
]);

export const outcomeSourceAbi = parseAbi([
  "function outcomeState(uint256 roundId) view returns (bool open,bool finalized,uint8 knownMask,uint8 values)",
  "function game() view returns (address)",
]);

export const localGameAbi = parseAbi([
  "function roundNum() view returns (uint256)",
  "function roundStats(uint256 roundId) view returns ((uint256 gestureCount,uint256 ethGestureCount,uint256 cstGestureCount,uint256 ethSpent,uint256 cstBurned,uint256 highestCstPaid,uint256 enduranceDuration,uint256 chronoDuration,uint256 enduranceGesture,uint256 chronoGesture,uint256 enduranceStart,uint256 previousEnduranceDuration,uint256 firstGestureTime,uint256 lastGestureTime,bool chronoInitialized,bool finalized) metrics)",
  "function mainPrizeTime() view returns (uint256)",
  "function getNextEthPrice() view returns (uint256)",
  "function getNextCstPrice() view returns (uint256)",
  "function bidEth() payable",
  "function bidCst(uint256 maxPrice)",
  "function closeCycle()",
  "error NotReady()",
  "error FirstGestureMustBeEth()",
  "error InvalidPayment()",
  "error LocalChainOnly()",
  "error ReentrantCall()",
  "error InsufficientAllowance()",
  "error InsufficientBalance()",
]);
export const localTokenAbi = parseAbi(["function faucet(uint256 amount)"]);
