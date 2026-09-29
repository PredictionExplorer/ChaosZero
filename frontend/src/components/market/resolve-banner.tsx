"use client";

import { Sparkles, Zap } from "lucide-react";
import { formatCount } from "@/lib/format";
import type { RoundSnapshot } from "@/lib/market";
import { roundPhase } from "@/lib/market";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/tooltip";

interface ResolveBannerProps {
  snapshot: RoundSnapshot;
  pending: boolean;
  connected: boolean;
  onResolve: () => Promise<boolean>;
  onConnect: () => void;
}

/**
 * Shown when the round is resolvable but unresolved: either it ended, or the
 * count crossed the threshold mid-round (early YES resolution).
 */
export function ResolveBanner({
  snapshot,
  pending,
  connected,
  onResolve,
  onConnect,
}: ResolveBannerProps) {
  const early = roundPhase(snapshot) === "decided";
  return (
    <Card accent="ended" className="p-5" data-testid="resolve-banner">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-ended">
            {early ? (
              <Zap className="size-5" aria-hidden />
            ) : (
              <Sparkles className="size-5" aria-hidden />
            )}
            {early ? "Threshold crossed — YES already won" : "The round has ended"}
          </h2>
          <p className="mt-1 text-sm text-ink-dim">
            {early ? (
              <>
                This round hit{" "}
                <span className="font-mono font-semibold text-ink" data-testid="banner-count">
                  {formatCount(snapshot.currentCount)}
                </span>{" "}
                gestures, beating last round&apos;s {formatCount(snapshot.threshold)} while still
                live. The count only goes up, so the outcome is certain — trading halted
                automatically.
              </>
            ) : (
              <>
                Final count:{" "}
                <span className="font-mono font-semibold text-ink" data-testid="banner-count">
                  {formatCount(snapshot.currentCount)}
                </span>{" "}
                vs {formatCount(snapshot.threshold)} to beat.
              </>
            )}{" "}
            Anyone can resolve — one transaction, no special permissions.
            <InfoTip
              label="About resolving"
              className="ml-1 align-text-bottom"
              content="Resolving just writes the final outcome on-chain so winners can claim. It's permissionless by design: no admin, no oracle committee — the contract reads the gesture count straight from the game."
            />
          </p>
        </div>
        <Button
          variant="ended"
          size="lg"
          loading={pending}
          onClick={() => (connected ? void onResolve() : onConnect())}
          data-testid="resolve-button"
        >
          {connected ? "Resolve round" : "Connect to resolve"}
        </Button>
      </div>
    </Card>
  );
}
