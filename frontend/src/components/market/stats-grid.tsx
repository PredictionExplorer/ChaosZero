"use client";

import { Activity, Coins, Droplets, Percent, Target, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";
import { formatBps, formatCount, formatCst } from "@/lib/format";
import type { RoundSnapshot } from "@/lib/market";
import { totalLiquidity } from "@/lib/market";
import { currentFeeBps } from "@/lib/math";
import { Card } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/tooltip";

interface StatsGridProps {
  snapshot: RoundSnapshot;
  volume: bigint;
}

interface Stat {
  readonly icon: ReactNode;
  readonly label: string;
  readonly value: string;
  readonly unit?: string;
  readonly hint: string;
}

/** The round's vital signs at a glance. */
export function StatsGrid({ snapshot, volume }: StatsGridProps) {
  const funded = snapshot.pool.totalShares > 0n;
  const stats: Stat[] = [
    {
      icon: <Activity className="size-4" aria-hidden />,
      label: "Gestures so far",
      value: formatCount(snapshot.currentCount),
      hint: "Bids placed in this Cosmic Signature round so far. Each bid is one gesture, and the count only ever goes up.",
    },
    {
      icon: <Target className="size-4" aria-hidden />,
      label: "To beat",
      value: snapshot.thresholdKnown ? formatCount(snapshot.threshold) : "—",
      hint: snapshot.thresholdKnown
        ? "Last round's final gesture count. YES wins only if this round finishes strictly higher — a tie means NO wins."
        : "The bar is still forming: it locks at the previous round's final count the moment that round ends.",
    },
    {
      icon: <TrendingUp className="size-4" aria-hidden />,
      label: "Volume",
      value: formatCst(volume),
      unit: "CST",
      hint: "Total CST wagered through bets in this market, adding up both YES and NO bets.",
    },
    {
      icon: <Droplets className="size-4" aria-hidden />,
      label: "Liquidity",
      value: formatCst(totalLiquidity(snapshot.pool)),
      hint: "Outcome tokens sitting in the pool — the market's depth. A deeper pool moves less when a bet lands.",
    },
    {
      icon: <Percent className="size-4" aria-hidden />,
      label: "Pool fee",
      value: funded ? formatBps(currentFeeBps(snapshot.pool)) : "—",
      hint: "What bettors pay the liquidity providers on every bet: the share-weighted average of all LPs' fee votes.",
    },
    {
      icon: <Coins className="size-4" aria-hidden />,
      label: "LP fees unclaimed",
      value: formatCst(snapshot.pool.feeReserve),
      unit: "CST",
      hint: "Trading fees earned by liquidity providers but not yet collected. LPs can claim their cut at any time.",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6" data-testid="stats-grid">
      {stats.map((stat) => (
        <Card key={stat.label} className="p-4">
          <div className="flex items-center gap-1.5 text-ink-faint">
            {stat.icon}
            <p className="text-[10px] font-semibold uppercase tracking-wider">{stat.label}</p>
            <InfoTip label={`About "${stat.label}"`} content={stat.hint} iconClassName="size-3" />
          </div>
          <p className="mt-1.5 font-mono text-sm font-semibold text-ink">
            {stat.value}
            {stat.unit && (
              <span className="ml-1 text-[10px] font-normal text-ink-faint">{stat.unit}</span>
            )}
          </p>
        </Card>
      ))}
    </div>
  );
}
