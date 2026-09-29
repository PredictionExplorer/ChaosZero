import { getAddress, isAddress, zeroAddress, type Address } from "viem";

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
