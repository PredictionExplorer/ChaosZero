"use client";

import { m, useReducedMotion } from "motion/react";
import { formatCount } from "@/lib/format";
import { Tooltip } from "@/components/ui/tooltip";

export interface ThresholdRaceProps {
  /** Gestures placed so far this round. */
  currentCount: number;
  /** The previous round's final count — the number to beat (strictly). */
  threshold: number;
  /** False while the round is still in the future: the previous round hasn't
   * finished, so there is no finish line to race toward yet. */
  thresholdKnown?: boolean;
  /** The previous round's id, for the pending-threshold copy. */
  prevRoundId?: bigint | null;
  resolved?: boolean;
  yesWon?: boolean;
}

/** Where a count sits on the track, in [0,1]. The track runs to ~120% of the
 * threshold so there is always visible room beyond the finish line. */
export function trackFraction(threshold: number, value: number): number {
  const trackEnd = Math.max(threshold * 1.2, threshold + 1, value, 1);
  return Math.min(1, Math.max(0, value / trackEnd));
}

/**
 * The round as a race toward the previous round's count: a progress track
 * with the threshold as the finish line. Crossing it decides the market.
 * While the threshold is still unknowable (future round), shows a pending
 * strip instead of a race to a meaningless zero.
 */
export function ThresholdRace({
  currentCount,
  threshold,
  thresholdKnown = true,
  prevRoundId = null,
  resolved = false,
  yesWon = false,
}: ThresholdRaceProps) {
  const reduced = useReducedMotion();
  const crossed = currentCount > threshold;

  if (!thresholdKnown) {
    return (
      <div data-testid="threshold-race" className="w-full select-none">
        <div
          data-testid="race-pending"
          className="flex h-10 items-center justify-center rounded-full border border-dashed border-line bg-surface-2/40 px-4 text-xs text-ink-faint"
        >
          The finish line isn&apos;t set yet — the threshold locks
          {prevRoundId !== null
            ? ` when round ${prevRoundId.toString()} ends`
            : " when the previous round ends"}
        </div>
        <div className="mt-1 flex items-baseline justify-between font-mono text-xs text-ink-faint">
          <Tooltip
            content="Gestures (bids) placed in this round so far. The count only ever goes up."
            align="start"
          >
            <span data-testid="race-current" className="cursor-help">
              {formatCount(currentCount)} <span className="text-[10px] uppercase">so far</span>
            </span>
          </Tooltip>
          <span className="text-[10px] uppercase tracking-widest text-ink-faint">
            threshold pending
          </span>
          <Tooltip
            content="The number to beat is unknown until the previous round finishes — it locks at that round's final gesture count."
            align="end"
          >
            <span data-testid="race-target" className="cursor-help text-ended">
              beat ?
            </span>
          </Tooltip>
        </div>
      </div>
    );
  }
  const progressPct = trackFraction(threshold, currentCount) * 100;
  const thresholdPct = trackFraction(threshold, threshold) * 100;
  const fillColor = crossed ? "bg-higher/80" : "bg-signal/70";

  return (
    <div data-testid="threshold-race" className="w-full select-none">
      <div className="relative h-10">
        {/* Track */}
        <div className="absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 rounded-full bg-surface-2" />
        {/* Progress fill */}
        <m.div
          data-testid="race-fill"
          className={`absolute left-0 top-1/2 h-2.5 -translate-y-1/2 rounded-full ${fillColor}`}
          animate={{ width: `${progressPct}%` }}
          initial={false}
          transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 120, damping: 24 }}
          style={reduced ? { width: `${progressPct}%` } : undefined}
        />
        {/* Finish line: the threshold */}
        <div
          data-testid="race-threshold"
          className="absolute top-1/2 h-7 w-1 -translate-x-1/2 -translate-y-1/2 rounded bg-ended shadow-[0_0_12px_rgba(255,195,85,0.7)]"
          style={{ left: `${thresholdPct}%` }}
        />
        {/* Runner marker */}
        <m.div
          data-testid="race-marker"
          className="absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
          animate={{ left: `${progressPct}%` }}
          initial={false}
          transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 120, damping: 24 }}
          style={reduced ? { left: `${progressPct}%` } : undefined}
        >
          <div
            className={[
              "size-4 rounded-full border-[3px] border-void",
              crossed || (resolved && yesWon)
                ? "bg-higher shadow-[0_0_16px_rgba(94,228,162,0.9)]"
                : "bg-ink shadow-[0_0_14px_rgba(240,237,250,0.7)]",
            ].join(" ")}
          />
        </m.div>
      </div>

      <div className="mt-1 flex items-baseline justify-between font-mono text-xs text-ink-faint">
        <Tooltip
          content="Gestures (bids) placed in this round so far. The count only ever goes up."
          align="start"
        >
          <span data-testid="race-current" className="cursor-help">
            {formatCount(currentCount)} <span className="text-[10px] uppercase">so far</span>
          </span>
        </Tooltip>
        <span className="text-[10px] uppercase tracking-widest text-ink-faint">
          {crossed ? "threshold crossed — YES wins" : "gestures vs last round"}
        </span>
        <Tooltip
          content={`The finish line: last round ended at ${formatCount(threshold)} gestures. Strictly more than that and YES wins — a tie or less means NO wins.`}
          align="end"
        >
          <span data-testid="race-target" className="cursor-help text-ended">
            beat {formatCount(threshold)}
          </span>
        </Tooltip>
      </div>
    </div>
  );
}
