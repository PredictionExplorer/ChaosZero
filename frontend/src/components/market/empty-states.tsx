"use client";

import { CircleAlert, PauseCircle, Telescope } from "lucide-react";
import type { RoundPhase } from "@/lib/market";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Shown when no market address is configured or passed via `?market=`. */
export function NoMarketConfigured() {
  return (
    <Card className="mx-auto max-w-xl p-10 text-center" data-testid="no-market">
      <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-signal/12 text-signal-bright">
        <Telescope className="size-7" aria-hidden />
      </span>
      <h1 className="mt-5 font-display text-2xl font-bold">No market in sight</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-dim">
        This deployment doesn&apos;t have a market configured yet. Set{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-signal-bright">
          NEXT_PUBLIC_MARKET_ADDRESS
        </code>{" "}
        to the deployed market contract, or open this page with{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-signal-bright">
          ?market=0x…
        </code>{" "}
        in the URL.
      </p>
    </Card>
  );
}

/** Full-page skeleton while the first snapshot loads. */
export function MarketSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-3" data-testid="market-skeleton">
      <div className="space-y-6 lg:col-span-2">
        <Skeleton className="h-105 w-full rounded-2xl" />
        <div className="grid grid-cols-3 gap-3">
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
        </div>
      </div>
      <Skeleton className="h-120 rounded-2xl" />
    </div>
  );
}

const BET_CLOSED_REASONS: Partial<Record<RoundPhase, string>> = {
  uninitialized:
    "Nobody has opened this round's pool yet. Betting starts as soon as the first liquidity arrives.",
  decided:
    "The gesture count already crossed the threshold — YES is certain and betting halted. The round can be resolved now.",
  ended:
    "This round is over and awaiting resolution. You can still redeem paired tokens or withdraw liquidity.",
  resolved: "This round is resolved. Winning tokens can be claimed from the position panel below.",
};

/** Shown on the bet tab for rounds that can no longer (or not yet) be bet on. */
export function BetClosed({ phase }: { phase: RoundPhase }) {
  return (
    <Card className="p-5" data-testid="bet-closed">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
        <PauseCircle className="size-4 text-ink-faint" aria-hidden />
        Betting closed
      </h2>
      <p className="mt-4 rounded-xl border border-dashed border-line p-4 text-center text-xs leading-relaxed text-ink-faint">
        {BET_CLOSED_REASONS[phase] ?? "Betting is not available for this round."}
      </p>
    </Card>
  );
}

/** Shown when the market snapshot cannot be fetched at all. */
export function MarketError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="mx-auto max-w-xl p-10 text-center" data-testid="market-error">
      <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-lower/12 text-lower">
        <CircleAlert className="size-7" aria-hidden />
      </span>
      <h1 className="mt-5 font-display text-2xl font-bold">Couldn&apos;t reach the market</h1>
      <p className="mt-3 break-words text-sm leading-relaxed text-ink-dim">{message}</p>
      <Button variant="outline" className="mt-6" onClick={onRetry}>
        Try again
      </Button>
    </Card>
  );
}
