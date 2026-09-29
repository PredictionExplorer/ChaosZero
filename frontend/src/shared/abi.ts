import { parseAbi } from "viem";

export const localGameAbi = parseAbi([
  "function roundNum() view returns (uint256)",
  "function roundStats(uint256 roundId) view returns ((uint256 gestureCount,uint256 ethSpent,uint256 cstBurned,uint256 highestCstPaid,uint256 enduranceDuration,uint256 chronoDuration,uint256 enduranceGesture,uint256 chronoGesture,uint256 enduranceStart,uint256 previousEnduranceDuration,uint256 firstGestureTime,uint256 lastGestureTime,bool chronoInitialized,bool finalized) metrics)",
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
export const localTokenAbi = parseAbi([
  "function faucet(uint256 amount)",
  "function transfer(address to,uint256 amount) returns (bool)",
  "error InsufficientBalance()",
  "error InvalidRecipient()",
]);
