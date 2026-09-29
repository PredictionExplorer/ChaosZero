"use client";

import { Droplets, HandCoins, Vote } from "lucide-react";
import { useMemo, useState } from "react";
import { formatBps, formatCst, parseCstInput } from "@/lib/format";
import type { PoolState } from "@/lib/math";
import {
  currentFeeBps,
  feeAfterDeclarationChange,
  joinPool,
  MIN_INITIAL_LIQUIDITY,
  minTokensOutForSlippage,
  openPool,
  removeLiquidity,
} from "@/lib/math";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InfoTip, Tooltip } from "@/components/ui/tooltip";

export interface LiquidityPanelProps {
  pool: PoolState;
  lpShares: bigint;
  lpPendingFees: bigint;
  /** The user's current fee vote, in bps. */
  lpDeclaredFeeBps: number;
  /** Whether the round currently accepts new liquidity (live phase only). */
  canAdd: boolean;
  /** Null when no wallet is connected. */
  balance: bigint | null;
  allowance: bigint | null;
  pendingAction: "approve" | "addLiquidity" | "removeLiquidity" | "updateFee" | "claimFees" | null;
  onConnect: () => void;
  onApprove: (amount: bigint) => Promise<boolean>;
  onAdd: (
    cstIn: bigint,
    declaredFeeBps: number,
    initialYesProbBps: bigint,
    minSharesOut: bigint,
  ) => Promise<boolean>;
  onRemove: (shares: bigint, minYesOut: bigint, minNoOut: bigint) => Promise<boolean>;
  onUpdateFee: (newFeeBps: number) => Promise<boolean>;
  onClaimFees: () => Promise<boolean>;
}

const SHARE_SLIPPAGE_BPS = 50;

function formatPctInput(bps: number): string {
  return (bps / 100).toLocaleString("en-US", { maximumFractionDigits: 1 });
}

/**
 * Provide liquidity into the round's single pool and earn the trading fee on
 * every bet, pro rata by shares. The fee itself is a liquidity-weighted VOTE:
 * you declare the fee you want when depositing (and can re-vote anytime);
 * the pool charges the share-weighted average of everyone's declarations.
 */
export function LiquidityPanel({
  pool,
  lpShares,
  lpPendingFees,
  lpDeclaredFeeBps,
  canAdd,
  balance,
  allowance,
  pendingAction,
  onConnect,
  onApprove,
  onAdd,
  onRemove,
  onUpdateFee,
  onClaimFees,
}: LiquidityPanelProps) {
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [input, setInput] = useState("");
  const [probPct, setProbPct] = useState(50);
  const [feeVoteBps, setFeeVoteBps] = useState(200);
  const [removePct, setRemovePct] = useState(100);
  const [showRevote, setShowRevote] = useState(false);
  const [revoteBps, setRevoteBps] = useState<number | null>(null);

  const poolOpen = pool.totalShares > 0n;
  const poolFee = currentFeeBps(pool);
  const parsed = parseCstInput(input);
  const amount = parsed.value;

  const addPreview = useMemo(() => {
    if (amount === null) return null;
    if (!poolOpen) {
      if (amount < MIN_INITIAL_LIQUIDITY)
        return { error: "Below the minimum first deposit (0.001 CST)" } as const;
      const result = openPool(amount, BigInt(probPct * 100), BigInt(feeVoteBps));
      return {
        shares: result.sharesOut,
        excessYes: result.excessYes,
        excessNo: result.excessNo,
        feeAfter: BigInt(feeVoteBps),
        error: null,
      } as const;
    }
    const result = joinPool(pool, amount, BigInt(feeVoteBps), {
      shares: lpShares,
      declaredFeeBps: BigInt(lpDeclaredFeeBps),
    });
    if (result === null) return { error: "Deposit too small for this pool" } as const;
    return {
      shares: result.sharesOut,
      excessYes: result.excessYes,
      excessNo: result.excessNo,
      feeAfter: currentFeeBps(result.pool),
      error: null,
    } as const;
  }, [amount, poolOpen, probPct, feeVoteBps, pool, lpShares, lpDeclaredFeeBps]);

  const removePreview = useMemo(() => {
    if (lpShares === 0n) return null;
    const shares = (lpShares * BigInt(removePct)) / 100n;
    if (shares === 0n) return null;
    const { yesOut, noOut } = removeLiquidity(pool, shares, BigInt(lpDeclaredFeeBps));
    return { shares, yesOut, noOut };
  }, [pool, lpShares, lpDeclaredFeeBps, removePct]);

  const revotePreview = useMemo(() => {
    if (revoteBps === null || lpShares === 0n) return null;
    return feeAfterDeclarationChange(pool, lpShares, BigInt(lpDeclaredFeeBps), BigInt(revoteBps));
  }, [pool, lpShares, lpDeclaredFeeBps, revoteBps]);

  const connected = balance !== null;
  const insufficient = connected && amount !== null && amount > (balance ?? 0n);
  const needsApproval = connected && amount !== null && (allowance ?? 0n) < amount;

  const submitAdd = async () => {
    if (!connected) {
      onConnect();
      return;
    }
    if (amount === null || !addPreview || addPreview.error !== null || insufficient) return;
    if (needsApproval) {
      await onApprove(amount);
      return;
    }
    const minShares = minTokensOutForSlippage(addPreview.shares, SHARE_SLIPPAGE_BPS);
    const ok = await onAdd(amount, feeVoteBps, BigInt(probPct * 100), minShares);
    if (ok) setInput("");
  };

  const submitRemove = async () => {
    if (!removePreview) return;
    const minYes = minTokensOutForSlippage(removePreview.yesOut, SHARE_SLIPPAGE_BPS);
    const minNo = minTokensOutForSlippage(removePreview.noOut, SHARE_SLIPPAGE_BPS);
    await onRemove(removePreview.shares, minYes, minNo);
  };

  const submitRevote = async () => {
    if (revoteBps === null) return;
    const ok = await onUpdateFee(revoteBps);
    if (ok) {
      setShowRevote(false);
      setRevoteBps(null);
    }
  };

  let addLabel: string;
  if (!connected) addLabel = "Connect wallet to provide";
  else if (amount === null) addLabel = "Enter an amount";
  else if (insufficient) addLabel = "Insufficient CST balance";
  else if (needsApproval) addLabel = "Approve CST";
  else if (!poolOpen) addLabel = "Open the pool & provide";
  else addLabel = "Add liquidity";

  return (
    <Card accent="signal" className="p-5" data-testid="liquidity-panel">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
          <Droplets className="size-4 text-signal-bright" aria-hidden />
          Provide liquidity
        </h2>
        <div
          className="flex rounded-lg border border-line p-0.5 text-xs"
          role="tablist"
          aria-label="Liquidity mode"
        >
          {(["add", "remove"] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              data-testid={`lp-mode-${m}`}
              onClick={() => setMode(m)}
              className={[
                "rounded-md px-2.5 py-1 capitalize transition-colors",
                mode === m ? "bg-signal/15 text-signal-bright" : "text-ink-faint hover:text-ink",
              ].join(" ")}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* The pool's live fee: a share-weighted vote. */}
      <div className="mt-3 flex items-center justify-between rounded-xl border border-line bg-surface-2/40 px-3 py-2.5">
        <span className="flex items-center gap-1 text-xs text-ink-faint">
          Pool fee — weighted vote of all LPs
          <InfoTip
            label="About the pool fee"
            content="Every bet pays this fee to the pool's liquidity providers. It isn't fixed: each LP declares the fee they want, and the pool charges the share-weighted average of all declarations — so it drifts as LPs join, leave, or re-vote."
          />
        </span>
        <span
          className="font-mono text-sm font-semibold text-signal-bright"
          data-testid="lp-pool-fee"
        >
          {poolOpen ? formatBps(poolFee) : "—"}
        </span>
      </div>

      {/* Your position */}
      {(lpShares > 0n || lpPendingFees > 0n) && (
        <div
          className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-2/40 px-3 py-2.5"
          data-testid="lp-position"
        >
          <div className="text-xs text-ink-dim">
            <span className="font-mono text-ink">{formatCst(lpShares)}</span>{" "}
            <Tooltip
              content="LP shares are your slice of the pool. They set your cut of every trading fee and how much of the reserves you get back when you withdraw."
              className="align-baseline"
            >
              <span className="cursor-help underline decoration-dotted decoration-ink-faint/60 underline-offset-2">
                shares
              </span>
            </Tooltip>{" "}
            · voting{" "}
            <Tooltip
              content="The fee you're currently voting for. Click to re-declare it — no deposit needed; your whole position switches to the new vote."
              tabIndex={-1}
              className="align-baseline"
            >
              <button
                className="font-mono text-signal-bright underline-offset-2 hover:underline"
                onClick={() => {
                  setShowRevote((v) => !v);
                  setRevoteBps(lpDeclaredFeeBps);
                }}
                data-testid="lp-my-vote"
              >
                {formatBps(BigInt(lpDeclaredFeeBps))}
              </button>
            </Tooltip>{" "}
            ·{" "}
            <span className="font-mono text-higher" data-testid="lp-pending-fees">
              {formatCst(lpPendingFees)}
            </span>{" "}
            <Tooltip
              content="Trading fees your shares have earned so far, in CST. Claim them anytime — they sit in escrow and don't compound into the pool."
              className="align-baseline"
            >
              <span className="cursor-help underline decoration-dotted decoration-ink-faint/60 underline-offset-2">
                CST earned
              </span>
            </Tooltip>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={lpPendingFees === 0n}
            loading={pendingAction === "claimFees"}
            onClick={() => void onClaimFees()}
            data-testid="claim-fees-button"
          >
            <HandCoins className="size-3.5" aria-hidden />
            Claim fees
          </Button>
        </div>
      )}

      {/* Re-vote without moving funds */}
      {showRevote && lpShares > 0n && (
        <div
          className="mt-3 rounded-xl border border-signal/30 bg-signal/8 p-3"
          data-testid="lp-revote"
        >
          <div className="flex items-baseline justify-between text-xs">
            <span className="flex items-center gap-1.5 text-ink-dim">
              <Vote className="size-3.5" aria-hidden /> Change your fee vote
            </span>
            <span className="font-mono font-semibold text-ink" data-testid="lp-revote-value">
              {formatPctInput(revoteBps ?? lpDeclaredFeeBps)}%
            </span>
          </div>
          <input
            type="range"
            className="chaos-range mt-2"
            min={0}
            max={1000}
            step={10}
            value={revoteBps ?? lpDeclaredFeeBps}
            onChange={(e) => setRevoteBps(Number(e.target.value))}
            aria-label="Your fee vote"
            data-testid="lp-revote-slider"
          />
          <div className="mt-2 flex items-center justify-between">
            <p className="text-[11px] text-ink-faint" data-testid="lp-revote-preview">
              {revotePreview !== null && (
                <>
                  Pool fee: {formatBps(poolFee)} → {formatBps(revotePreview)}
                </>
              )}
            </p>
            <Button
              variant="outline"
              size="sm"
              loading={pendingAction === "updateFee"}
              onClick={() => void submitRevote()}
              data-testid="lp-revote-submit"
            >
              Update vote
            </Button>
          </div>
        </div>
      )}

      {mode === "add" ? (
        !canAdd ? (
          <p
            className="mt-4 rounded-xl border border-dashed border-line p-4 text-center text-xs text-ink-faint"
            data-testid="lp-add-closed"
          >
            Adding liquidity is closed for this round (it&apos;s decided, ended, or resolved). You
            can still remove, re-vote, and claim fees at any time.
          </p>
        ) : (
          <>
            <div className="mt-4 rounded-xl border border-line bg-void/50 p-3 focus-within:border-signal/50">
              <div className="flex items-center justify-between text-[11px] text-ink-faint">
                <label htmlFor="lp-amount">Amount</label>
                {connected && (
                  <span>
                    Balance: <span className="font-mono">{formatCst(balance ?? 0n)}</span>
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-center gap-2">
                <input
                  id="lp-amount"
                  data-testid="lp-amount-input"
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
                <p className="mt-1 text-xs text-lower" role="alert">
                  {parsed.error}
                </p>
              )}
            </div>

            {/* Your fee vote (applies to your WHOLE position). */}
            <div
              className="mt-3 rounded-xl border border-line bg-surface-2/40 p-3"
              data-testid="lp-fee-vote"
            >
              <div className="flex items-baseline justify-between text-xs">
                <span className="flex items-center gap-1 text-ink-faint">
                  Your fee vote — what bettors should pay
                  <InfoTip
                    label="About your fee vote"
                    content="Your vote, weighted by your shares, pulls the pool's average fee toward this value. A higher fee earns LPs more per bet but makes betting less attractive."
                  />
                </span>
                <span className="font-mono font-semibold text-ink" data-testid="lp-fee-vote-value">
                  {formatPctInput(feeVoteBps)}%
                </span>
              </div>
              <input
                type="range"
                className="chaos-range mt-2"
                min={0}
                max={1000}
                step={10}
                value={feeVoteBps}
                onChange={(e) => setFeeVoteBps(Number(e.target.value))}
                aria-label="Your fee vote in percent"
                data-testid="lp-fee-vote-slider"
              />
              <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
                The pool charges the share-weighted average of all votes; earnings split by shares.
                Depositing re-votes your whole position at this value.
              </p>
            </div>

            {/* First LP sets the opening odds. */}
            {!poolOpen && (
              <div
                className="mt-3 rounded-xl border border-line bg-surface-2/40 p-3"
                data-testid="lp-odds"
              >
                <div className="flex items-baseline justify-between text-xs">
                  <span className="flex items-center gap-1 text-ink-faint">
                    Opening odds — chance of YES
                    <InfoTip
                      label="About opening odds"
                      content="The pool prices YES at these odds until trades move it. At 60%, a YES token costs 0.60 CST and a NO token 0.40 CST. Trading starts from here."
                    />
                  </span>
                  <span className="font-mono font-semibold text-ink" data-testid="lp-odds-value">
                    {probPct}%
                  </span>
                </div>
                <input
                  type="range"
                  className="chaos-range mt-2"
                  min={1}
                  max={99}
                  value={probPct}
                  onChange={(e) => setProbPct(Number(e.target.value))}
                  aria-label="Opening YES probability"
                  data-testid="lp-odds-slider"
                />
                <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
                  You&apos;re the first LP: pick where the odds open. Misjudged odds are free money
                  for arbitrageurs, so open near your honest estimate.
                </p>
              </div>
            )}

            {addPreview && "error" in addPreview && addPreview.error !== null && (
              <p className="mt-3 text-xs text-lower" role="alert" data-testid="lp-add-error">
                {addPreview.error}
              </p>
            )}
            {addPreview && addPreview.error === null && (
              <dl
                className="mt-3 space-y-2 rounded-xl border border-line bg-surface-2/40 p-3 text-xs"
                data-testid="lp-add-preview"
              >
                <div className="flex justify-between">
                  <dt className="flex items-center gap-1 text-ink-faint">
                    LP shares
                    <InfoTip
                      label="About LP shares"
                      content="Your slice of the pool. Shares set your cut of every trading fee and how many YES/NO tokens you get back when you withdraw. They are not CST."
                    />
                  </dt>
                  <dd className="font-mono font-semibold text-ink" data-testid="lp-preview-shares">
                    {formatCst(addPreview.shares)}
                  </dd>
                </div>
                {(addPreview.excessYes > 0n || addPreview.excessNo > 0n) && (
                  <div className="flex justify-between">
                    <dt className="flex items-center gap-1 text-ink-faint">
                      Returned to you
                      <InfoTip
                        label='About "Returned to you"'
                        content={
                          <>
                            Your CST first mints equal YES + NO tokens, but the pool only keeps them
                            at its current odds ratio. The leftover side comes straight back to your
                            wallet as outcome tokens. Nothing is lost — hold them as a position, or
                            pair them with the other side later (1 YES + 1 NO always redeems for 1
                            CST).
                          </>
                        }
                      />
                    </dt>
                    <dd className="font-mono text-ink-dim" data-testid="lp-preview-excess">
                      {addPreview.excessYes > 0n
                        ? `${formatCst(addPreview.excessYes)} YES`
                        : `${formatCst(addPreview.excessNo)} NO`}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="flex items-center gap-1 text-ink-faint">
                    Pool fee after your deposit
                    <InfoTip
                      label="About the fee change"
                      content="Depositing re-votes your whole position at the fee you chose above, which shifts the pool's share-weighted average — from today's fee to the value shown here."
                    />
                  </dt>
                  <dd className="font-mono text-signal-bright" data-testid="lp-preview-fee">
                    {poolOpen ? `${formatBps(poolFee)} → ` : ""}
                    {formatBps(addPreview.feeAfter)}
                  </dd>
                </div>
              </dl>
            )}

            <Button
              className="mt-4 w-full"
              size="lg"
              variant="signal"
              disabled={
                connected &&
                (amount === null || insufficient || !!parsed.error || addPreview?.error != null)
              }
              loading={pendingAction === "approve" || pendingAction === "addLiquidity"}
              onClick={() => void submitAdd()}
              data-testid="lp-add-submit"
            >
              {addLabel}
            </Button>

            <p className="mt-3 text-center text-[11px] leading-relaxed text-ink-faint">
              LP risk: the gesture count is public, so late traders are informed — fees are your
              compensation. Size accordingly and withdraw when the round stops being uncertain.
            </p>
          </>
        )
      ) : (
        <>
          {lpShares === 0n ? (
            <p
              className="mt-4 rounded-xl border border-dashed border-line p-4 text-center text-xs text-ink-faint"
              data-testid="lp-no-position"
            >
              No LP position in this round&apos;s pool.
            </p>
          ) : (
            <>
              <div
                className="mt-4 rounded-xl border border-line bg-surface-2/40 p-3"
                data-testid="lp-remove-box"
              >
                <div className="flex items-baseline justify-between text-xs">
                  <span className="text-ink-faint">Remove</span>
                  <span className="font-mono font-semibold text-ink" data-testid="lp-remove-pct">
                    {removePct}%
                  </span>
                </div>
                <input
                  type="range"
                  className="chaos-range mt-3"
                  min={1}
                  max={100}
                  value={removePct}
                  onChange={(e) => setRemovePct(Number(e.target.value))}
                  aria-label="Share of your liquidity to remove"
                  data-testid="lp-remove-slider"
                />
                {removePreview && (
                  <dl className="mt-3 space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <dt className="flex items-center gap-1 text-ink-faint">
                        You receive
                        <InfoTip
                          label="About what you receive"
                          content="Your share of the pool's reserves, paid in outcome tokens at the pool's current ratio. Matched YES + NO pairs redeem 1:1 for CST; the unmatched rest keeps market exposure until the round resolves."
                        />
                      </dt>
                      <dd className="font-mono text-ink" data-testid="lp-remove-preview">
                        {formatCst(removePreview.yesOut)} YES + {formatCst(removePreview.noOut)} NO
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="flex items-center gap-1 text-ink-faint">
                        Plus accrued fees
                        <InfoTip
                          label="About accrued fees"
                          content="Any removal automatically pays out ALL trading fees you've earned so far — the full amount shown here, even if you only withdraw part of your shares."
                        />
                      </dt>
                      <dd className="font-mono text-higher">{formatCst(lpPendingFees)} CST</dd>
                    </div>
                  </dl>
                )}
              </div>
              <Button
                className="mt-4 w-full"
                size="lg"
                variant="outline"
                loading={pendingAction === "removeLiquidity"}
                onClick={() => void submitRemove()}
                data-testid="lp-remove-submit"
              >
                Remove liquidity
              </Button>
              <p className="mt-3 text-center text-[11px] leading-relaxed text-ink-faint">
                Withdrawals work at ANY time — even mid-round or after resolution. Paired YES+NO
                tokens redeem 1:1 for CST; the unpaired rest is your market exposure. Removed shares
                stop voting on the fee.
              </p>
            </>
          )}
        </>
      )}
    </Card>
  );
}
