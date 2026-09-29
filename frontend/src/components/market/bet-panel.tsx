"use client";

import { Check, Settings2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { formatUnits } from "viem";
import { appConfig } from "@/lib/config";
import { formatBps, formatCst, parseCstInput } from "@/lib/format";
import type { BetSide, PoolState } from "@/lib/math";
import {
  currentFeeBps,
  entryProbability,
  minTokensOutForSlippage,
  poolIsTradable,
  quoteBet,
  takeFee,
} from "@/lib/math";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/tooltip";

export interface BetPanelProps {
  pool: PoolState;
  /** Null when no wallet is connected. */
  balance: bigint | null;
  allowance: bigint | null;
  pendingAction: "approve" | "bet" | null;
  onConnect: () => void;
  onApprove: (amount: bigint) => Promise<boolean>;
  onBet: (side: BetSide, cstIn: bigint, minTokensOut: bigint) => Promise<boolean>;
}

const SLIPPAGE_PRESETS_BPS = [10, 50, 100] as const;

/**
 * Place a bet: pick YES/NO, type CST, see the exact quote (client-side pure
 * math, mirrors the contract — including the pool's live LP-voted fee).
 * The slippage floor from the same quote is what protects the bet from
 * liquidity pulls, sandwiches, and fee-vote jumps.
 */
export function BetPanel({
  pool,
  balance,
  allowance,
  pendingAction,
  onConnect,
  onApprove,
  onBet,
}: BetPanelProps) {
  const [side, setSide] = useState<BetSide>("yes");
  const [input, setInput] = useState("");
  const [slippageBps, setSlippageBps] = useState<number>(50);
  const [showSettings, setShowSettings] = useState(false);

  const parsed = parseCstInput(input);
  const amount = parsed.value;
  const feeBps = currentFeeBps(pool);

  const quote = useMemo(() => {
    if (amount === null) return null;
    const tokensOut = quoteBet(side, pool, amount);
    if (tokensOut === 0n) return null;
    const minOut = minTokensOutForSlippage(tokensOut, slippageBps);
    const { fee } = takeFee(amount, feeBps);
    const entry = entryProbability(amount, tokensOut);
    return { tokensOut, minOut, fee, entry };
  }, [amount, side, pool, feeBps, slippageBps]);

  const connected = balance !== null;
  const insufficient = connected && amount !== null && amount > (balance ?? 0n);
  const needsApproval = connected && amount !== null && (allowance ?? 0n) < amount;
  const busy = pendingAction !== null;
  const noLiquidity = !poolIsTradable(pool);

  const submit = async () => {
    if (!connected) {
      onConnect();
      return;
    }
    if (amount === null || quote === null || insufficient) return;
    if (needsApproval) {
      await onApprove(amount);
      return;
    }
    const ok = await onBet(side, amount, quote.minOut);
    if (ok) setInput("");
  };

  const sideColor = side === "yes" ? "text-higher" : "text-lower";

  let buttonLabel: string;
  if (!connected) buttonLabel = "Connect wallet to bet";
  else if (noLiquidity) buttonLabel = "No liquidity yet";
  else if (amount === null) buttonLabel = "Enter an amount";
  else if (insufficient) buttonLabel = "Insufficient CST balance";
  else if (needsApproval) buttonLabel = "Approve CST";
  else buttonLabel = side === "yes" ? "Bet YES" : "Bet NO";

  return (
    <Card accent={side === "yes" ? "higher" : "lower"} className="p-5" data-testid="bet-panel">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">Place your bet</h2>
        <button
          aria-label="Slippage settings"
          onClick={() => setShowSettings((v) => !v)}
          className={`rounded-lg p-1.5 transition-colors hover:bg-surface-2 ${showSettings ? "text-signal-bright" : "text-ink-faint"}`}
        >
          <Settings2 className="size-4" />
        </button>
      </div>

      {showSettings && (
        <div
          className="mt-3 flex items-center justify-between rounded-xl border border-line bg-surface-2/50 px-3 py-2"
          data-testid="slippage-settings"
        >
          <span className="flex items-center gap-1 text-xs text-ink-dim">
            Max slippage
            <InfoTip
              label="About max slippage"
              content="How much worse than the quote you're willing to accept before your bet reverts instead of filling. Tighter is safer but fails more often when the market moves fast."
            />
          </span>
          <div className="flex gap-1">
            {SLIPPAGE_PRESETS_BPS.map((bps) => (
              <button
                key={bps}
                onClick={() => setSlippageBps(bps)}
                className={[
                  "rounded-lg px-2.5 py-1 font-mono text-xs transition-colors",
                  slippageBps === bps
                    ? "bg-signal/20 text-signal-bright"
                    : "text-ink-faint hover:text-ink",
                ].join(" ")}
              >
                {(bps / 100).toLocaleString("en-US")}%
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Side selector */}
      <div className="mt-4 grid grid-cols-2 gap-2" role="tablist" aria-label="Bet direction">
        <button
          role="tab"
          aria-selected={side === "yes"}
          data-testid="tab-yes"
          onClick={() => setSide("yes")}
          className={[
            "flex items-center justify-center gap-2 rounded-xl border py-3 font-display text-sm font-bold uppercase tracking-wide transition-all",
            side === "yes"
              ? "border-higher/60 bg-higher/12 text-higher shadow-glow-higher"
              : "border-line text-ink-faint hover:border-line-strong hover:text-ink-dim",
          ].join(" ")}
        >
          <Check className="size-4" aria-hidden /> Yes
        </button>
        <button
          role="tab"
          aria-selected={side === "no"}
          data-testid="tab-no"
          onClick={() => setSide("no")}
          className={[
            "flex items-center justify-center gap-2 rounded-xl border py-3 font-display text-sm font-bold uppercase tracking-wide transition-all",
            side === "no"
              ? "border-lower/60 bg-lower/12 text-lower shadow-glow-lower"
              : "border-line text-ink-faint hover:border-line-strong hover:text-ink-dim",
          ].join(" ")}
        >
          <X className="size-4" aria-hidden /> No
        </button>
      </div>

      <p className="mt-2 text-center text-xs text-ink-faint">
        You win if this round{" "}
        <span className={`font-semibold ${sideColor}`}>
          {side === "yes" ? "beats" : "doesn't beat"}
        </span>{" "}
        last round&apos;s gesture count
      </p>

      {/* Amount */}
      <div className="mt-4 rounded-xl border border-line bg-void/50 p-3 focus-within:border-signal/50">
        <div className="flex items-center justify-between text-[11px] text-ink-faint">
          <label htmlFor="bet-amount">Amount</label>
          {connected && (
            <button
              className="transition-colors hover:text-signal-bright"
              onClick={() => setInput(balance && balance > 0n ? formatUnits(balance, 18) : "")}
              data-testid="max-button"
            >
              Balance: <span className="font-mono">{formatCst(balance ?? 0n)}</span> · MAX
            </button>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <input
            id="bet-amount"
            data-testid="amount-input"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.0"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="w-full bg-transparent font-display text-2xl font-semibold text-ink outline-none placeholder:text-ink-faint/50"
          />
          <span className="rounded-lg bg-surface-2 px-2.5 py-1 font-mono text-xs font-semibold text-ink-dim">
            CST
          </span>
        </div>
        {parsed.error && (
          <p className="mt-1 text-xs text-lower" role="alert" data-testid="input-error">
            {parsed.error}
          </p>
        )}
      </div>

      {/* Quote */}
      {quote !== null && !parsed.error && (
        <dl
          className="mt-4 space-y-2 rounded-xl border border-line bg-surface-2/40 p-3 text-xs"
          data-testid="quote-box"
        >
          <div className="flex justify-between">
            <dt className="flex items-center gap-1 text-ink-faint">
              You receive
              <InfoTip
                label="About the tokens you receive"
                content={`Outcome tokens bought from the pool after the fee. Each ${side.toUpperCase()} token pays exactly 1 CST if ${side.toUpperCase()} wins — so more tokens per CST means better odds for you.`}
              />
            </dt>
            <dd className={`font-mono font-semibold ${sideColor}`} data-testid="quote-tokens">
              {formatCst(quote.tokensOut)} {side.toUpperCase()}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="flex items-center gap-1 text-ink-faint">
              Payout if {side.toUpperCase()} wins
              <InfoTip
                label="About the payout"
                content="What you can claim at resolution if you're right: 1 CST per token. If you're wrong, your tokens pay nothing."
              />
            </dt>
            <dd className="font-mono text-ink" data-testid="quote-payout">
              {formatCst(quote.tokensOut)} CST
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="flex items-center gap-1 text-ink-faint">
              Your entry (implied chance)
              <InfoTip
                label="About your entry price"
                content={`The probability you're effectively paying for: CST in ÷ tokens out. Your bet is profitable if ${side.toUpperCase()}'s real chance is better than this. Big bets push the price against you, so this is worse than the headline market odds.`}
              />
            </dt>
            <dd className="font-mono text-ink" data-testid="quote-entry">
              {quote.entry === null
                ? "—"
                : `${(quote.entry * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="flex items-center gap-1 text-ink-faint">
              Fee ({formatBps(feeBps)}, LP-voted)
              <InfoTip
                label="About the fee"
                content="Taken off the top of your bet and escrowed for the pool's liquidity providers. The rate is the share-weighted average of all LP fee votes, so it can drift as LPs re-vote."
              />
            </dt>
            <dd className="font-mono text-ink-dim" data-testid="quote-fee">
              {formatCst(quote.fee)} CST
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="flex items-center gap-1 text-ink-faint">
              Min received (slippage {(slippageBps / 100).toLocaleString("en-US")}%)
              <InfoTip
                label="About the minimum received"
                content="Your protection floor. If other transactions land first and the pool would give you fewer tokens than this, your bet reverts instead of filling badly."
              />
            </dt>
            <dd className="font-mono text-ink-dim" data-testid="quote-min-out">
              {formatCst(quote.minOut)}
            </dd>
          </div>
        </dl>
      )}

      <Button
        className="mt-4 w-full"
        size="lg"
        variant={!connected || needsApproval ? "signal" : side === "yes" ? "higher" : "lower"}
        disabled={connected && (noLiquidity || amount === null || insufficient || !!parsed.error)}
        loading={busy}
        onClick={() => void submit()}
        data-testid="bet-submit"
      >
        {busy ? (pendingAction === "approve" ? "Approving…" : "Confirming…") : buttonLabel}
      </Button>

      <p className="mt-3 text-center text-[11px] leading-relaxed text-ink-faint">
        Bets are placed in CST on {appConfig.chain.name}. A winning token pays exactly 1 CST at
        resolution; a losing token pays 0. Exit early any time by betting the other side and
        redeeming pairs.
      </p>
    </Card>
  );
}
