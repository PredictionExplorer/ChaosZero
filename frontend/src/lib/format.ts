import { formatUnits, parseUnits } from "viem";

export const CST_DECIMALS = 18;

/**
 * Formats a CST amount (18 decimals) for humans: thousands separators and a
 * sensible number of decimals for the magnitude (more precision for small
 * amounts, none for large ones).
 */
export function formatCst(amount: bigint, opts?: { decimals?: number }): string {
  const value = Number(formatUnits(amount, CST_DECIMALS));
  const decimals =
    opts?.decimals ??
    (Math.abs(value) >= 1000
      ? 0
      : Math.abs(value) >= 10
        ? 1
        : Math.abs(value) >= 0.01 || value === 0
          ? 2
          : 4);
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

/** Formats a whole-number count (gestures) with thousands separators. */
export function formatCount(count: bigint | number): string {
  const n = typeof count === "bigint" ? Number(count) : count;
  return Math.round(n).toLocaleString("en-US");
}

/** Formats a fractional count to one decimal, e.g. for the live prediction readout. */
export function formatCountPrecise(count: number): string {
  return count.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** `0x1234…abcd` style address shortening. */
export function shortAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Signed CST delta with an explicit sign, e.g. `+12.5` / `−3.2`. */
export function formatSignedCst(amount: bigint): string {
  if (amount === 0n) return "0";
  const abs = amount < 0n ? -amount : amount;
  return `${amount < 0n ? "−" : "+"}${formatCst(abs)}`;
}

/** Percentage with one decimal from a basis-points value. */
export function formatBps(bps: bigint): string {
  const pct = Number(bps) / 100;
  return `${pct.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

/** Relative time like "3m ago" for activity feeds. */
export function timeAgo(unixSeconds: number, nowMs: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor(nowMs / 1000) - unixSeconds);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export interface ParseResult {
  readonly value: bigint | null;
  readonly error: string | null;
}

/**
 * Parses a user-typed CST amount into wei. Strict but friendly: accepts
 * `1`, `0.5`, `.5`, `1,000.25`; rejects negatives, zero, exponent notation,
 * and more than 18 decimals.
 */
export function parseCstInput(input: string): ParseResult {
  const raw = input.trim().replace(/,/g, "");
  if (raw === "") return { value: null, error: null };
  if (!/^\d*\.?\d*$/.test(raw) || raw === ".") {
    return { value: null, error: "Enter a valid amount" };
  }
  const [, fraction = ""] = raw.split(".");
  if (fraction.length > CST_DECIMALS) {
    return { value: null, error: `Max ${CST_DECIMALS} decimal places` };
  }
  let value: bigint;
  try {
    value = parseUnits(raw, CST_DECIMALS);
  } catch {
    return { value: null, error: "Enter a valid amount" };
  }
  if (value <= 0n) return { value: null, error: "Amount must be more than 0" };
  return { value, error: null };
}
