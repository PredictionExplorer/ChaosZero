"use client";

import { ChevronLeft, ChevronRight, Radio, Telescope } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { Tooltip } from "@/components/ui/tooltip";

interface RoundNavProps {
  roundId: bigint;
  /** The game's live round; null while loading. */
  currentRound: bigint | null;
}

/**
 * Navigate between rounds of the series via the `?round=` query param.
 * Past rounds stay claimable forever, ANY future round is open for early
 * positions, and "Live" jumps back to following the game's current round.
 */
export function RoundNav({ roundId, currentRound }: RoundNavProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const navigate = useCallback(
    (target: bigint | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (target === null) params.delete("round");
      else params.set("round", target.toString());
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, searchParams],
  );

  const onLive = currentRound !== null && roundId === currentRound;
  const isFuture = currentRound !== null && roundId > currentRound;

  return (
    <nav
      className="flex items-center justify-between"
      aria-label="Round navigation"
      data-testid="round-nav"
    >
      <button
        onClick={() => navigate(roundId - 1n)}
        disabled={roundId <= 1n}
        data-testid="round-prev"
        className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronLeft className="size-3.5" aria-hidden />
        Round {(roundId - 1n).toString()}
      </button>

      <div className="flex items-center gap-2 text-sm">
        <span className="font-display font-semibold text-ink" data-testid="round-current">
          Round {roundId.toString()}
        </span>
        {isFuture && (
          <Tooltip
            side="bottom"
            content="The game hasn't reached this round yet. Its threshold is still unknown, but the market is already open — positions taken now are early bets."
          >
            <span
              data-testid="round-future"
              className="flex cursor-help items-center gap-1 rounded-full border border-signal/40 bg-signal/10 px-2.5 py-0.5 text-[11px] font-semibold text-signal-bright"
            >
              <Telescope className="size-3" aria-hidden />
              Future
            </span>
          </Tooltip>
        )}
        {!onLive && (
          <Tooltip
            side="bottom"
            content="Back to the round the game is playing right now."
            tabIndex={-1}
          >
            <button
              onClick={() => navigate(null)}
              data-testid="round-live"
              className="flex items-center gap-1 rounded-full border border-higher/40 bg-higher/10 px-2.5 py-0.5 text-[11px] font-semibold text-higher transition-colors hover:bg-higher/20"
            >
              <Radio className="size-3" aria-hidden />
              Jump to live
            </button>
          </Tooltip>
        )}
      </div>

      <button
        onClick={() => navigate(roundId + 1n)}
        disabled={currentRound === null}
        data-testid="round-next"
        className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
      >
        Round {(roundId + 1n).toString()}
        <ChevronRight className="size-3.5" aria-hidden />
      </button>
    </nav>
  );
}
