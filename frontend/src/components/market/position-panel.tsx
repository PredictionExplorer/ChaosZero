"use client";

import { Gift, RefreshCcw } from "lucide-react";
import { formatCst } from "@/lib/format";
import type { RoundSnapshot, UserSnapshot } from "@/lib/market";
import { displayedProbability, hasPosition, positionValueFloat, roundPhase } from "@/lib/market";
import { claimValue } from "@/lib/math";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InfoTip, Tooltip } from "@/components/ui/tooltip";

export interface PositionPanelProps {
  snapshot: RoundSnapshot;
  user: UserSnapshot;
  pendingAction: "redeem" | "claim" | null;
  onRedeemSets: (amount: bigint) => Promise<boolean>;
  onClaim: () => Promise<boolean>;
}

/**
 * The connected user's outcome tokens: YES/NO balances, their mark-to-market
 * value, redeeming complete sets, and claiming after resolution.
 */
export function PositionPanel({
  snapshot,
  user,
  pendingAction,
  onRedeemSets,
  onClaim,
}: PositionPanelProps) {
  const phase = roundPhase(snapshot);
  const value = positionValueFloat(snapshot, user);
  const sets = user.yesBalance < user.noBalance ? user.yesBalance : user.noBalance;
  const probability = displayedProbability(snapshot);
  const claimable =
    phase === "resolved" ? claimValue(user.yesBalance, user.noBalance, snapshot.yesWon) : 0n;

  if (!hasPosition(user)) return null;

  return (
    <Card accent="signal" className="p-5" data-testid="position-panel">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">Your position</h2>
        <Tooltip
          align="end"
          content={
            phase === "resolved"
              ? "The round is settled: winning tokens pay exactly 1 CST each, losing tokens pay 0."
              : probability === null
                ? "The pool has no liquidity yet, so there's no market price to value your tokens against."
                : "The market's current implied chance of YES. Your position value below is marked against it."
          }
        >
          <span className="cursor-help text-xs text-ink-faint underline decoration-dotted decoration-ink-faint/60 underline-offset-2">
            {phase === "resolved"
              ? `settled — ${snapshot.yesWon ? "YES" : "NO"} won`
              : probability === null
                ? "no market price yet"
                : `marked at ${(probability * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}% YES`}
          </span>
        </Tooltip>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-higher/25 bg-higher/8 p-3">
          <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-higher">
            Yes
            <InfoTip
              label="About YES tokens"
              align="start"
              content="Your YES tokens. Each pays exactly 1 CST if this round beats the threshold — and 0 if it doesn't."
              iconClassName="size-3"
            />
          </p>
          <p className="mt-1 font-mono text-lg font-semibold" data-testid="yes-balance">
            {formatCst(user.yesBalance)}
          </p>
        </div>
        <div className="rounded-xl border border-lower/25 bg-lower/8 p-3">
          <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-lower">
            No
            <InfoTip
              label="About NO tokens"
              content="Your NO tokens. Each pays exactly 1 CST if this round does NOT beat the threshold (a tie counts as NO) — and 0 if it does."
              iconClassName="size-3"
            />
          </p>
          <p className="mt-1 font-mono text-lg font-semibold" data-testid="no-balance">
            {formatCst(user.noBalance)}
          </p>
        </div>
        <div className="rounded-xl border border-signal/25 bg-signal/8 p-3">
          <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-signal-bright">
            {phase === "resolved" ? "Claimable" : "Value now"}
            <InfoTip
              label={phase === "resolved" ? "About your claimable amount" : 'About "Value now"'}
              align="end"
              content={
                phase === "resolved"
                  ? "The exact CST you can withdraw: 1 CST for every winning token you hold."
                  : "A mark-to-market estimate: YES tokens × chance + NO tokens × (1 − chance) at the pool's current odds. It moves with the market and is not a guaranteed exit price."
              }
              iconClassName="size-3"
            />
          </p>
          <p className="mt-1 font-mono text-lg font-semibold" data-testid="position-value">
            <AnimatedNumber
              value={value}
              format={(v) => v.toLocaleString("en-US", { maximumFractionDigits: 2 })}
            />{" "}
            <span className="text-xs text-ink-dim">CST</span>
          </p>
        </div>
      </div>

      {phase === "decided" && (
        <p
          className="mt-3 rounded-xl border border-ended/30 bg-ended/8 p-3 text-center text-xs text-ended"
          data-testid="decided-note"
        >
          The count crossed the threshold — YES has already won. Resolve the round to unlock
          claiming.
        </p>
      )}

      <div className="mt-4 flex flex-col gap-2">
        {phase === "resolved" && (
          <Button
            variant="signal"
            size="lg"
            className="w-full"
            loading={pendingAction === "claim"}
            onClick={() => void onClaim()}
            data-testid="claim-button"
          >
            <Gift className="size-4" aria-hidden />
            Claim {formatCst(claimable)} CST
          </Button>
        )}

        {phase !== "resolved" && sets > 0n && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-2/40 px-4 py-3">
            <p className="text-xs text-ink-dim">
              You hold <span className="font-mono text-ink">{formatCst(sets)}</span>{" "}
              <Tooltip
                align="start"
                className="align-baseline"
                content="1 YES + 1 NO is a complete set, worth exactly 1 CST no matter how the round ends. Redeeming swaps your matched pairs back into CST now and keeps your one-sided exposure untouched."
              >
                <span className="cursor-help underline decoration-dotted decoration-ink-faint/60 underline-offset-2">
                  complete sets
                </span>
              </Tooltip>{" "}
              — redeemable 1:1 for CST
            </p>
            <Button
              variant="outline"
              size="sm"
              loading={pendingAction === "redeem"}
              onClick={() => void onRedeemSets(sets)}
              data-testid="redeem-button"
            >
              <RefreshCcw className="size-3.5" aria-hidden />
              Redeem
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
