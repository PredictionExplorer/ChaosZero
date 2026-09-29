"use client";

import type { ProbabilityPoint } from "@/lib/history";
import type { RoundSnapshot } from "@/lib/market";
import { displayedProbability, roundPhase } from "@/lib/market";
import { formatCount } from "@/lib/format";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { InfoTip, Tooltip } from "@/components/ui/tooltip";
import { ProbabilityChart } from "./probability-chart";
import { ThresholdRace } from "./threshold-race";

interface MarketHeroProps {
  snapshot: RoundSnapshot;
  history: readonly ProbabilityPoint[];
}

const PHASE_BADGE = {
  uninitialized: {
    tone: "muted" as const,
    label: "Awaiting first liquidity",
    pulse: false,
    tip: "No one has funded this round's pool yet. The first liquidity provider opens the market and picks the opening odds.",
  },
  future: {
    tone: "signal" as const,
    label: "Future round — open for early positions",
    pulse: false,
    tip: "The game hasn't reached this round yet, but its market is already tradable — you can take positions before the round even starts.",
  },
  live: {
    tone: "higher" as const,
    label: "Live",
    pulse: true,
    tip: "This game round is underway and the market is open: bet, provide liquidity, or exit at any time.",
  },
  decided: {
    tone: "ended" as const,
    label: "Threshold crossed — YES won, awaiting resolution",
    pulse: true,
    tip: "The gesture count already passed the threshold, so YES is certain (the count only goes up). Betting is halted; claiming unlocks once anyone resolves the round.",
  },
  ended: {
    tone: "ended" as const,
    label: "Round ended — awaiting resolution",
    pulse: true,
    tip: "The game round is over and the outcome is final on-chain. Once anyone sends the (permissionless) resolve transaction, winners can claim.",
  },
  resolved: {
    tone: "signal" as const,
    label: "Resolved",
    pulse: false,
    tip: "The outcome is written on-chain. Winning tokens pay 1 CST each and can be claimed forever — there's no deadline.",
  },
};

/** The threshold line: locked value, forming value, or not-yet-knowable. */
function ThresholdCopy({ snapshot }: { snapshot: RoundSnapshot }) {
  if (snapshot.thresholdKnown) {
    return (
      <p className="flex items-center gap-1 text-xs text-ink-faint">
        Beat last round&apos;s{" "}
        <span className="font-mono font-semibold text-ended" data-testid="hero-threshold">
          {formatCount(snapshot.threshold)}
        </span>{" "}
        gestures
        <InfoTip
          label="About the threshold"
          align="end"
          content="The number to beat, locked at the previous round's final gesture count. YES wins only if this round ends strictly higher — a tie means NO wins."
        />
      </p>
    );
  }
  const prevRound = snapshot.roundId - 1n;
  if (snapshot.roundId === snapshot.gameRoundNum + 1n) {
    return (
      <p
        className="flex items-center gap-1 text-xs text-ink-faint"
        data-testid="hero-threshold-forming"
      >
        Threshold forming:{" "}
        <span className="font-mono font-semibold text-ended">
          {formatCount(snapshot.prevRoundCount)}
        </span>{" "}
        gestures in round {prevRound.toString()} so far, still climbing
        <InfoTip
          label="About the forming threshold"
          align="end"
          content={`Round ${prevRound.toString()} is still being played, so the finish line is still moving. It locks at that round's final gesture count the moment the round ends.`}
        />
      </p>
    );
  }
  return (
    <p
      className="flex items-center gap-1 text-xs text-ink-faint"
      data-testid="hero-threshold-unknown"
    >
      Threshold locks when round {prevRound.toString()} ends
      <InfoTip
        label="About the unknown threshold"
        align="end"
        content={`This market's number to beat will be round ${prevRound.toString()}'s final gesture count — unknowable until that round is over. You're betting on the gap between two future rounds.`}
      />
    </p>
  );
}

/** The market's centerpiece: will this round out-gesture the last one? */
export function MarketHero({ snapshot, history }: MarketHeroProps) {
  const phase = roundPhase(snapshot);
  const probability = displayedProbability(snapshot);
  const badge = PHASE_BADGE[phase];

  return (
    <Card accent="signal" className="p-6 sm:p-8" data-testid="market-hero">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Tooltip content={badge.tip} side="bottom" align="start">
            <Badge
              tone={badge.tone}
              pulse={badge.pulse}
              className="cursor-help"
              data-testid="phase-badge"
            >
              {badge.label}
            </Badge>
          </Tooltip>
          <Tooltip
            content={`Each market in the series tracks one Cosmic Signature round — this one is round ${snapshot.roundId.toString()}. Use the arrows above to browse past (still claimable) or future (already tradable) rounds.`}
            side="bottom"
          >
            <Badge tone="muted" className="cursor-help">
              Round {snapshot.roundId.toString()}
            </Badge>
          </Tooltip>
        </div>
        <ThresholdCopy snapshot={snapshot} />
      </div>

      <div className="mt-6 flex flex-col items-center text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-ink-dim">
          {phase === "resolved"
            ? snapshot.yesWon
              ? "Resolved: YES — more gestures than last round"
              : "Resolved: NO — didn't beat last round"
            : "Chance this round beats the last one"}
        </p>
        <div className="mt-1 font-display text-6xl font-bold tabular-nums sm:text-7xl">
          {probability === null ? (
            <span className="text-ink-faint" data-testid="hero-no-liquidity">
              —
            </span>
          ) : (
            <span
              className={phase === "resolved" ? "text-ended" : "text-glow-signal text-ink"}
              data-testid="hero-probability"
            >
              <AnimatedNumber
                value={probability * 100}
                format={(v) =>
                  `${v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
                }
              />
            </span>
          )}
        </div>
        <p className="mt-1 flex items-center justify-center gap-1 text-sm text-ink-dim">
          {phase === "resolved" ? (
            <>
              <span>
                final count{" "}
                <span className="font-mono font-semibold text-ink" data-testid="hero-final-count">
                  {formatCount(snapshot.currentCount)}
                </span>{" "}
                vs threshold {formatCount(snapshot.threshold)} — winning tokens pay 1 CST each
              </span>
              <InfoTip
                label="About claiming"
                content="Anyone holding tokens of the winning side can swap them for CST, 1:1, at any time — there is no claim deadline."
              />
            </>
          ) : probability === null ? (
            <>no liquidity yet — the first LP opens the market at their chosen odds</>
          ) : (
            <>
              <span>implied by the pools, weighted by liquidity</span>
              <InfoTip
                label="About this probability"
                content="The pool prices YES like an AMM: chance of YES = NO reserve ÷ (YES reserve + NO reserve). Every bet shifts the reserves, so this number is the market's live consensus — deeper liquidity makes it harder to push around."
              />
            </>
          )}
        </p>
      </div>

      <div className="mt-8">
        <ThresholdRace
          currentCount={Number(snapshot.currentCount)}
          threshold={Number(snapshot.threshold)}
          thresholdKnown={snapshot.thresholdKnown}
          prevRoundId={snapshot.roundId === 0n ? null : snapshot.roundId - 1n}
          resolved={phase === "resolved"}
          yesWon={snapshot.yesWon}
        />
      </div>

      <div className="mt-6">
        <ProbabilityChart points={history} />
      </div>
    </Card>
  );
}
