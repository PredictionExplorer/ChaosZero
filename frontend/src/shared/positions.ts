import { getAddress, isAddress, zeroAddress, type Address } from "viem";
import { claimable, feasibleReserves, yesProbabilityBps, type SharedPool } from "./math";
import { answerYes, questionKnown } from "./questions";

export type PositionAmounts = readonly [
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
];
export const MAX_ROUND_ID = (1n << 252n) - 1n;
const MAX_POSITION_ID = (1n << 256n) - 1n;

/** ERC-1155 IDs encode one cycle, one question, and exactly one outcome. */
export function positionId(roundId: bigint, question: number, yes: boolean): bigint {
  if (
    roundId < 0n ||
    roundId > MAX_ROUND_ID ||
    !Number.isInteger(question) ||
    question < 0 ||
    question >= 8
  )
    throw new Error("Invalid position identity");
  return (roundId << 4n) | (BigInt(question) << 1n) | (yes ? 1n : 0n);
}

export function decodePositionId(id: bigint): { roundId: bigint; question: number; yes: boolean } {
  if (id < 0n || id > MAX_POSITION_ID) throw new Error("Invalid position identity");
  return { roundId: id >> 4n, question: Number((id >> 1n) & 7n), yes: (id & 1n) === 1n };
}

function checkBalances(yes: readonly bigint[], no: readonly bigint[]) {
  if (yes.length !== 8 || no.length !== 8 || [...yes, ...no].some((amount) => amount < 0n))
    throw new Error("Invalid position balances");
}

/** Matching is per question, never a min across the two aggregate sides. */
export function matchedSets(yes: readonly bigint[], no: readonly bigint[]): PositionAmounts {
  checkBalances(yes, no);
  const smaller = (i: number) => (yes[i] < no[i] ? yes[i] : no[i]);
  return [
    smaller(0),
    smaller(1),
    smaller(2),
    smaller(3),
    smaller(4),
    smaller(5),
    smaller(6),
    smaller(7),
  ];
}

export function totalMatchedSets(yes: readonly bigint[], no: readonly bigint[]): bigint {
  return matchedSets(yes, no).reduce((sum, amount) => sum + amount, 0n);
}

export function collateralBreakdown(pool: SharedPool) {
  const reserves = feasibleReserves(pool);
  const minimumReserve = reserves.reduce(
    (lowest, row) => (row.reserve < lowest ? row.reserve : lowest),
    pool.collateral,
  );
  return { held: pool.collateral, maximumPayout: pool.collateral - minimumReserve, minimumReserve };
}

/**
 * Paired units have exact 1:1 value even in an unfunded market. Only unpaired,
 * unresolved units use marginal market prices. This is not an executable sale quote.
 */
export function portfolioValue(pool: SharedPool, yes: readonly bigint[], no: readonly bigint[]) {
  const matched = matchedSets(yes, no);
  let indicativeValue = 0n;
  let priceAvailable = true;
  for (let i = 0; i < 8; i++) {
    if (questionKnown(pool.knownMask, i)) {
      indicativeValue += answerYes(pool.values, i) ? yes[i] : no[i];
      continue;
    }
    indicativeValue += matched[i];
    const yesRemainder = yes[i] - matched[i];
    const noRemainder = no[i] - matched[i];
    if (yesRemainder === 0n && noRemainder === 0n) continue;
    const price = yesProbabilityBps(pool, i);
    if (price === null) {
      priceAvailable = false;
      continue;
    }
    indicativeValue += (yesRemainder * price + noRemainder * (10_000n - price)) / 10_000n;
  }
  return {
    matchedCollateral: matched.reduce((sum, amount) => sum + amount, 0n),
    claimable: claimable(yes, no, pool.knownMask, pool.values),
    indicativeValue: priceAvailable ? indicativeValue : null,
  };
}

export function validateRecipient(
  raw: string,
  sender: Address | undefined,
  market: Address,
): { address: Address | null; error: string | null } {
  const value = raw.trim();
  if (!value) return { address: null, error: null };
  if (!isAddress(value))
    return { address: null, error: "Enter a valid wallet or receiving-contract address." };
  const address = getAddress(value);
  if (address === zeroAddress)
    return { address: null, error: "Positions cannot be sent to the zero address." };
  if (address.toLowerCase() === market.toLowerCase())
    return { address: null, error: "Positions cannot be sent to the market contract." };
  if (sender && address.toLowerCase() === sender.toLowerCase())
    return { address: null, error: "Choose a recipient other than your connected wallet." };
  return { address, error: null };
}
