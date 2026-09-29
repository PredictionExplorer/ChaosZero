"use client";

import {
  Check,
  CheckCheck,
  Droplets,
  Flag,
  HandCoins,
  Layers,
  Lock,
  Sparkles,
  Undo2,
  Vote,
  Waves,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import type { ActivityEvent } from "@/hooks/use-market-events";
import { formatBps, formatCount, formatCst, timeAgo } from "@/lib/format";
import { AddressLink } from "@/components/ui/address-link";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface ActivityFeedProps {
  events: readonly ActivityEvent[];
  isLoading: boolean;
  maxItems?: number;
}

function iconBubble(tone: "higher" | "lower" | "signal" | "ended", child: ReactNode): ReactNode {
  const classes = {
    higher: "bg-higher/12 text-higher",
    lower: "bg-lower/12 text-lower",
    signal: "bg-signal/12 text-signal-bright",
    ended: "bg-ended/12 text-ended",
  }[tone];
  return (
    <span className={`flex size-7 items-center justify-center rounded-full ${classes}`}>
      {child}
    </span>
  );
}

function describe(event: ActivityEvent): { icon: ReactNode; text: ReactNode } {
  switch (event.kind) {
    case "bet": {
      const yes = event.side === "yes";
      return {
        icon: iconBubble(
          yes ? "higher" : "lower",
          yes ? <Check className="size-3.5" aria-hidden /> : <X className="size-3.5" aria-hidden />,
        ),
        text: (
          <>
            bet{" "}
            <span className="font-mono font-semibold text-ink">{formatCst(event.amount)} CST</span>{" "}
            on{" "}
            <span className={yes ? "font-semibold text-higher" : "font-semibold text-lower"}>
              {yes ? "YES" : "NO"}
            </span>
          </>
        ),
      };
    }
    case "add":
      return {
        icon: iconBubble("signal", <Droplets className="size-3.5" aria-hidden />),
        text: (
          <>
            added{" "}
            <span className="font-mono font-semibold text-ink">{formatCst(event.amount)} CST</span>{" "}
            of liquidity
            {event.feeBps !== null && (
              <span className="text-ink-faint"> · voting {formatBps(BigInt(event.feeBps))}</span>
            )}
          </>
        ),
      };
    case "remove":
      return {
        icon: iconBubble("signal", <Waves className="size-3.5" aria-hidden />),
        text: <>removed liquidity from the pool</>,
      };
    case "feeVote":
      return {
        icon: iconBubble("signal", <Vote className="size-3.5" aria-hidden />),
        text: (
          <>
            re-voted the fee to{" "}
            <span className="font-mono font-semibold text-signal-bright">
              {event.feeBps !== null ? formatBps(BigInt(event.feeBps)) : "—"}
            </span>
          </>
        ),
      };
    case "feesClaimed":
      return {
        icon: iconBubble("higher", <HandCoins className="size-3.5" aria-hidden />),
        text: (
          <>
            claimed{" "}
            <span className="font-mono font-semibold text-ink">{formatCst(event.amount)} CST</span>{" "}
            in LP fees
          </>
        ),
      };
    case "mint":
      return {
        icon: iconBubble("signal", <Layers className="size-3.5" aria-hidden />),
        text: (
          <>
            minted{" "}
            <span className="font-mono font-semibold text-ink">{formatCst(event.amount)}</span> sets
          </>
        ),
      };
    case "redeem":
      return {
        icon: iconBubble("signal", <Undo2 className="size-3.5" aria-hidden />),
        text: (
          <>
            redeemed{" "}
            <span className="font-mono font-semibold text-ink">{formatCst(event.amount)}</span> sets
            for CST
          </>
        ),
      };
    case "resolved":
      return {
        icon: iconBubble("ended", <Flag className="size-3.5" aria-hidden />),
        text: (
          <>
            round resolved{" "}
            <span
              className={event.yesWon ? "font-semibold text-higher" : "font-semibold text-lower"}
            >
              {event.yesWon ? "YES" : "NO"}
            </span>{" "}
            at{" "}
            <span className="font-mono font-semibold text-ended">
              {formatCount(event.secondary)} gestures
            </span>
          </>
        ),
      };
    case "claimed":
      return {
        icon: iconBubble("higher", <CheckCheck className="size-3.5" aria-hidden />),
        text: (
          <>
            claimed{" "}
            <span className="font-mono font-semibold text-ink">{formatCst(event.amount)} CST</span>
          </>
        ),
      };
    case "roundInitialized":
      return {
        icon: iconBubble("signal", <Sparkles className="size-3.5" aria-hidden />),
        text: <>market opened for this round</>,
      };
    case "thresholdLocked":
      return {
        icon: iconBubble("ended", <Lock className="size-3.5" aria-hidden />),
        text: (
          <>
            threshold locked at{" "}
            <span className="font-mono font-semibold text-ended">
              {formatCount(event.secondary)} gestures
            </span>
          </>
        ),
      };
  }
}

/** Reverse-chronological feed of everything happening in the round. */
export function ActivityFeed({ events, isLoading, maxItems = 40 }: ActivityFeedProps) {
  return (
    <Card className="p-5" data-testid="activity-feed">
      <h2 className="font-display text-lg font-semibold">Activity</h2>
      {isLoading ? (
        <div className="mt-4 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <p
          className="mt-4 rounded-xl border border-dashed border-line p-6 text-center text-sm text-ink-faint"
          data-testid="activity-empty"
        >
          No activity yet this round — provide liquidity or place the first bet.
        </p>
      ) : (
        <ul className="scroll-thin mt-4 max-h-105 space-y-1 overflow-y-auto pr-1">
          {events.slice(0, maxItems).map((event) => {
            const { icon, text } = describe(event);
            return (
              <li
                key={`${event.transactionHash}-${event.logIndex}`}
                className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-surface-2/60"
              >
                {icon}
                <div className="min-w-0 flex-1 text-sm text-ink-dim">
                  {event.user ? (
                    <AddressLink address={event.user} className="mr-1.5 align-baseline" />
                  ) : null}
                  {text}
                </div>
                <div className="shrink-0 text-right">
                  <AddressLink
                    address={event.transactionHash}
                    kind="tx"
                    label={event.timestamp ? timeAgo(event.timestamp) : "view tx"}
                    className="text-[11px]"
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
