"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Check, Copy, Layers3, Wallet } from "lucide-react";
import type { Address } from "viem";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConnectButton } from "@/components/wallet/connect-button";
import { formatCst, parseCstInput } from "@/lib/format";
import { TransferPositionPanel } from "@/shared/transfer-position-panel";
import { useIndependentFundingPreview } from "./use-independent-market";
import { quoteIndependentTrade, independentYesProbabilityBps } from "@/shared/independent-math";
import { MAX_COLLATERAL } from "@/shared/math";
import { matchedSets } from "@/shared/positions";
import { formatQuestionMetric } from "@/shared/question-metrics";
import { answerYes, QUESTIONS, type QuestionId } from "@/shared/questions";
import {
  effectiveQuestions,
  exactCst,
  fundingBreakdown,
  independentPortfolioValue,
  MIN_AUTO_TOP_UP,
  nextAbsorption,
  parseFundingAmount,
  questionExposure,
  tradeAccess,
  winningClaims,
  type IndependentActions,
  type IndependentSnapshot,
  type IndependentWallet,
} from "./models";

export const fieldClass =
  "h-11 w-full rounded-xl border border-line-strong bg-void/70 px-3 font-mono text-sm text-ink outline-none focus:border-signal focus:ring-1 focus:ring-signal disabled:opacity-50";
export const percent = (value: bigint | number | null, final = false) => {
  if (value === null) return "—";
  if (!final && value === 0n) return "<0.01%";
  if (!final && value === 10_000n) return ">99.99%";
  return `${(Number(value) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
};

export function IndependentQuestionCard({
  question,
  snapshot,
  selected,
  onSelect,
}: {
  question: QuestionId;
  snapshot: IndependentSnapshot;
  selected: boolean;
  onSelect: (yes: boolean) => void;
}) {
  const item = QUESTIONS[question];
  const state = snapshot.questions[question];
  const access = tradeAccess(snapshot);
  // Prices are those the next trade meets: after any pending absorption.
  const effective = effectiveQuestions(snapshot)[question];
  const incoming = effective.pool.collateral - state.pool.collateral;
  const yesWon = answerYes(snapshot.values, question);
  const probability = snapshot.finalized
    ? yesWon
      ? 10_000n
      : 0n
    : effective.funded
      ? independentYesProbabilityBps(effective.pool)
      : null;
  const noProbability = snapshot.finalized
    ? yesWon
      ? 0n
      : 10_000n
    : effective.funded
      ? independentYesProbabilityBps({
          ...effective.pool,
          yes: effective.pool.no,
          no: effective.pool.yes,
          initialYesBps: 10_000 - effective.pool.initialYesBps,
        })
      : null;
  const exposure = questionExposure(state, snapshot.settled, snapshot.finalized, yesWon);
  return (
    <Card
      accent={snapshot.finalized ? (yesWon ? "higher" : "lower") : selected ? "signal" : "none"}
      className={`flex flex-col p-5 ${selected ? "ring-1 ring-signal/50" : ""}`}
      data-testid={`question-${question}`}
    >
      <div className="mb-4 flex justify-between gap-2">
        <span className="font-mono text-xs text-ink-faint">
          {String(question + 1).padStart(2, "0")}
        </span>
        <span
          className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${snapshot.finalized ? (yesWon ? "bg-higher/10 text-higher" : "bg-lower/10 text-lower") : "bg-signal/10 text-signal-bright"}`}
        >
          {snapshot.finalized
            ? `Resolved ${yesWon ? "YES" : "NO"}`
            : state.funded
              ? "Trading"
              : access.opensPools
                ? "Opens with the first trade"
                : "Needs funding"}
        </span>
      </div>
      <h2 className="font-display text-lg font-semibold">{item.title}</h2>
      <p className="mt-2 min-h-10 text-xs leading-5 text-ink-dim">{item.question}</p>
      <div className="my-4 grid grid-cols-2 gap-3 border-y border-line py-3 text-xs">
        <div>
          <p className="mb-1 text-ink-faint">{item.currentLabel ?? "This cycle"}</p>
          <p className="font-mono" data-testid={`current-${question}`}>
            {formatQuestionMetric(snapshot.local?.current, question)}
          </p>
        </div>
        <div>
          <p className="mb-1 text-ink-faint">{item.condition ? "Condition" : "Previous cycle"}</p>
          <p className="font-mono">
            {item.condition ?? formatQuestionMetric(snapshot.local?.previous, question)}
          </p>
        </div>
      </div>
      <div className="mb-4 space-y-2 text-[11px] text-ink-dim">
        <div className="flex justify-between">
          <span>{snapshot.settled ? "Reserved for claims" : "This question’s CST"}</span>
          <span className="font-mono" data-testid={`question-collateral-${question}`}>
            {formatCst(snapshot.settled ? state.escrowRemaining : exposure.collateral)} CST
          </span>
        </div>
        {incoming > 0n && (
          <div className="flex justify-between text-signal-bright">
            <span>{state.funded ? "Joins with the next trade" : "Opens with"}</span>
            <span className="font-mono" data-testid={`question-incoming-${question}`}>
              +{formatCst(incoming)} CST
            </span>
          </div>
        )}
        <div className="flex justify-between">
          <span>Remaining reserve</span>
          <span className="font-mono" data-testid={`question-reserve-${question}`}>
            {formatCst(exposure.reserve)} CST
          </span>
        </div>
        <div className="flex justify-between">
          <span>Starting YES price</span>
          <span className="font-mono" data-testid={`question-seed-${question}`}>
            {state.pool.initialYesBps > 0 ? percent(state.pool.initialYesBps) : "—"}
          </span>
        </div>
        <p data-testid={`question-history-${question}`}>
          {state.usedHistory
            ? "Inherited from the previous cycle’s middle-window price average."
            : "Fallback seed: no covering prior price history."}
        </p>
      </div>
      <div className="mt-auto grid grid-cols-2 gap-2">
        {[true, false].map((yes) => (
          <button
            key={String(yes)}
            aria-label={`Buy ${yes ? "YES" : "NO"}: ${item.title}`}
            disabled={snapshot.finalized || !snapshot.open}
            onClick={() => onSelect(yes)}
            className={`flex min-h-11 items-center justify-between rounded-xl border px-3 text-sm font-semibold focus-visible:outline-2 disabled:cursor-default disabled:opacity-65 ${yes ? "border-higher/25 bg-higher/5 text-higher hover:bg-higher/15 focus-visible:outline-higher" : "border-lower/25 bg-lower/5 text-lower hover:bg-lower/15 focus-visible:outline-lower"}`}
          >
            <span>{yes ? "YES" : "NO"}</span>
            <span className="font-mono">
              {percent(yes ? probability : noProbability, snapshot.finalized)}
            </span>
          </button>
        ))}
      </div>
      <details className="mt-3 text-xs leading-5 text-ink-dim">
        <summary className="cursor-pointer text-ink-faint">Settlement rule</summary>
        <p className="pt-2">{item.detail} Trading continues until the cycle closes.</p>
      </details>
    </Card>
  );
}

export function IndependentTradePanel({
  snapshot,
  question,
  yes,
  buy,
  connected,
  actions,
  onSide,
  onMode,
}: {
  snapshot: IndependentSnapshot;
  question: QuestionId;
  yes: boolean;
  buy: boolean;
  connected: boolean;
  actions: IndependentActions;
  onSide: (yes: boolean) => void;
  onMode: (buy: boolean) => void;
}) {
  const [input, setInput] = useState("");
  const parsed = parseCstInput(input);
  const access = tradeAccess(snapshot);
  // Quote only the pool the trade will meet: it absorbs held CST before pricing.
  // Memoized so the quote effect reruns only when the effective pool itself changes.
  const pool = useMemo(() => effectiveQuestions(snapshot)[question].pool, [snapshot, question]);
  const allocation = nextAbsorption(snapshot)?.allocations[question] ?? 0n;
  const amount = parsed.value ?? 0n;
  const available = buy
    ? snapshot.user?.balance
    : yes
      ? snapshot.user?.yes[question]
      : snapshot.user?.no[question];
  const enabled = access.tradeable && amount > 0n;
  const [computed, setComputed] = useState<{ key: string; value: bigint } | null>(null);
  const key = `${snapshot.roundId}:${question}:${pool.collateral}:${pool.yes}:${pool.no}:${pool.initialYesBps}:${allocation}:${yes}:${buy}:${amount}:${enabled}`;
  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(
      () => setComputed({ key, value: quoteIndependentTrade(pool, yes, buy, amount) }),
      150,
    );
    return () => clearTimeout(timer);
  }, [key, enabled, pool, yes, buy, amount]);
  const calculating = enabled && computed?.key !== key;
  const output = enabled && computed?.key === key ? computed.value : 0n;
  const approval = buy && amount > (snapshot.user?.allowance ?? 0n);
  const error =
    parsed.error ??
    (available !== undefined && amount > available
      ? `Not enough ${buy ? "CST" : "position units"}.`
      : enabled && !calculating && output === 0n
        ? "This amount has no executable quote."
        : null);
  const ready = enabled && output > 0n && !error;
  return (
    <Card accent="signal" className="p-5" data-testid="independent-trade-panel">
      <h2 className="font-display text-lg font-semibold">Trade this question</h2>
      <p className="my-4 text-sm">{QUESTIONS[question].question}</p>
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-void/70 p-1">
        {[true, false].map((value) => (
          <button
            key={String(value)}
            aria-pressed={buy === value}
            disabled={!!actions.pending}
            onClick={() => {
              onMode(value);
              setInput("");
            }}
            className={`rounded-lg py-2 text-sm ${buy === value ? "bg-surface-2 text-ink" : "text-ink-dim"}`}
          >
            {value ? "Buy" : "Sell"}
          </button>
        ))}
      </div>
      <div className="mb-5 grid grid-cols-2 gap-2">
        {[true, false].map((value) => (
          <button
            key={String(value)}
            aria-pressed={yes === value}
            disabled={!!actions.pending}
            onClick={() => onSide(value)}
            className={`rounded-xl border py-2.5 text-sm font-semibold ${yes === value ? (value ? "border-higher bg-higher/15 text-higher" : "border-lower bg-lower/15 text-lower") : "border-line text-ink-dim"}`}
          >
            {value ? "YES" : "NO"}
          </button>
        ))}
      </div>
      {snapshot.finalized ? (
        <p className="rounded-xl bg-surface-2 p-4 text-sm text-ink-dim">
          The cycle is closed. Winning units pay 1 CST each from this cycle’s claim reserve.
        </p>
      ) : !snapshot.open ? (
        <p className="text-sm text-ink-dim">Trading is unavailable for this cycle.</p>
      ) : !access.tradeable ? (
        <p className="text-sm text-ink-dim" data-testid="independent-trade-unfunded">
          This cycle’s eight pools have not opened. An “Add CST” gift opens them; so does the first
          trade once carried or held CST is waiting.
        </p>
      ) : (
        <>
          {access.absorbed > 0n && (
            <p
              className="mb-4 rounded-xl border border-signal/30 bg-signal/5 p-3 text-xs leading-5 text-ink-dim"
              data-testid="independent-trade-absorption"
            >
              {access.opensPools
                ? `This trade opens this cycle’s eight pools first${access.settlesPrevious ? ", after settling the preceding cycle and reserving its winning claims" : ""}. It places ${formatCst(access.absorbed)} CST of carried and held funds across them before pricing, so it costs a higher network fee than a normal trade.`
                : `This trade first distributes ${formatCst(access.absorbed)} CST of held contributions across all eight pools, then prices against the deeper pool. The network fee is higher than a normal trade.`}{" "}
              The quote below already includes this.
            </p>
          )}
          <label
            htmlFor="independent-trade-amount"
            className="mb-2 flex justify-between text-xs text-ink-dim"
          >
            <span>{buy ? "CST to spend" : "Position units to sell"}</span>
            <span>Balance {available === undefined ? "—" : formatCst(available)}</span>
          </label>
          <input
            id="independent-trade-amount"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            className={fieldClass}
            disabled={!!actions.pending}
            aria-invalid={!!error}
          />
          <p role={error ? "alert" : undefined} className="mt-2 min-h-4 text-xs text-lower">
            {error}
          </p>
          <dl className="my-4 space-y-3 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-ink-dim">You receive</dt>
              <dd className="break-all font-mono" data-testid="independent-trade-output">
                {calculating ? "Calculating…" : output > 0n ? exactCst(output) : "—"}{" "}
                {buy ? `${yes ? "YES" : "NO"} units` : "CST"}
              </dd>
            </div>
            {buy && (
              <div className="flex justify-between">
                <dt className="text-ink-dim">If correct</dt>
                <dd className="font-mono text-higher">
                  {output > 0n ? `${formatCst(output)} CST` : "—"}
                </dd>
              </div>
            )}
          </dl>
          {!connected ? (
            <ConnectButton />
          ) : (
            <Button
              className="w-full"
              variant={yes ? "higher" : "lower"}
              disabled={!ready || !!actions.pending}
              loading={
                actions.pending === "Position purchase" || actions.pending === "Position sale"
              }
              onClick={async () => {
                if (!ready) return;
                if (approval) await actions.approve(amount);
                else if (await actions.trade(question, yes, buy, amount, output)) setInput("");
              }}
            >
              {approval ? "Approve CST to trade" : `${buy ? "Buy" : "Sell"} ${yes ? "YES" : "NO"}`}
            </Button>
          )}
          <p className="mt-3 text-[11px] leading-5 text-ink-faint">
            Only this question’s pool determines your quote. Exact amounts are checked on-chain; a
            changed price can require a new quote. No trading fee.
          </p>
        </>
      )}
    </Card>
  );
}

/** What the permissionless trigger will place, or why it is unavailable. */
function triggerExplanation(snapshot: IndependentSnapshot): string {
  const trigger = nextAbsorption(snapshot);
  const held = snapshot.heldContributions;
  if (trigger) {
    const { carry, held: joining } = fundingBreakdown(trigger, 0n);
    return snapshot.funded
      ? `${exactCst(trigger.totalFunding)} CST of held contributions enters all eight pools. Anyone can trigger this; the next trade does the same before it is priced.`
      : `Opens the eight pools with ${exactCst(carry)} carried and ${exactCst(joining)} held CST${trigger.needsSettlement ? ", after settling the preceding cycle" : ""}. Anyone can trigger this; the first trade does the same.`;
  }
  if (snapshot.funded) {
    if (held === 0n)
      return "Nothing is waiting. CST sent directly to the market joins the pools with the next trade or when anyone distributes it.";
    if (held < MIN_AUTO_TOP_UP)
      return `${exactCst(held)} CST is held. Amounts under ${formatCst(MIN_AUTO_TOP_UP)} CST wait: any “Add CST” gift sweeps them in, otherwise they join the next cycle’s pools.`;
    return "The pools are at capacity, so held CST waits for the next cycle’s pools.";
  }
  if (snapshot.funding?.needsSettlement)
    return "The preceding funded cycle cannot be settled yet, so this cycle’s pools cannot open. Try again once its closure data is available.";
  if (!snapshot.funding?.totalFunding)
    return "Nothing is carried or held for this cycle yet. An “Add CST” gift opens its pools.";
  return `${exactCst(snapshot.funding.totalFunding)} CST is waiting but cannot open this cycle’s pools yet; it may be below the opening minimum. An “Add CST” gift adds to it.`;
}

/** Market address for plain CST transfers, with the irrevocable-gift warning. */
export function DirectTransferNotice({ market }: { market: Address }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  return (
    <div className="mt-5 border-t border-line pt-4" data-testid="independent-direct-transfer">
      <h3 className="text-sm font-semibold">Or send CST directly</h3>
      <div className="mt-2 flex items-center gap-2">
        <code
          className="min-w-0 flex-1 break-all rounded-lg bg-void/70 px-2 py-1.5 font-mono text-[11px] text-ink"
          data-testid="independent-market-address"
        >
          {market}
        </code>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Copy market address"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(market);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? (
            <Check className="size-4" aria-hidden />
          ) : (
            <Copy className="size-4" aria-hidden />
          )}
        </Button>
      </div>
      <p role="status" className="mt-1 min-h-4 text-[11px] text-ink-faint">
        {copied === null
          ? ""
          : copied
            ? "Address copied."
            : "Copy failed. Select the address instead."}
      </p>
      <p className="mt-1 text-[11px] leading-5 text-ended">
        Send only CST: any other token sent here is lost. A direct transfer is an irrevocable gift
        with no shares, fees or withdrawal rights, and a mistaken transfer cannot be returned.
      </p>
      <p className="mt-2 text-[11px] leading-5 text-ink-faint">
        A plain transfer runs no market code. While a cycle is trading, it joins all eight pools
        with the next trade or when anyone distributes it; under {formatCst(MIN_AUTO_TOP_UP)} CST
        waits for a gift or the next cycle. Otherwise it joins the next cycle’s pools when they
        open.
      </p>
    </div>
  );
}

export function IndependentFundingPanel({
  snapshot,
  connected,
  actions,
}: {
  snapshot: IndependentSnapshot;
  connected: boolean;
  actions: IndependentActions;
}) {
  const [input, setInput] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const parsed = parseFundingAmount(input);
  const amount = parsed.value ?? 0n;
  const live = snapshot.open && !snapshot.finalized;
  const previewQuery = useIndependentFundingPreview(
    snapshot.market,
    snapshot.roundId,
    amount > 0n ? amount : null,
    live,
  );
  const preview = amount > 0n ? previewQuery.data : undefined;
  const breakdown = preview ? fundingBreakdown(preview, amount) : null;
  const trigger = nextAbsorption(snapshot);
  const held = snapshot.heldContributions;
  const approval = amount > (snapshot.user?.allowance ?? 0n);
  const error =
    parsed.error ??
    (snapshot.user && amount > snapshot.user.balance
      ? "Not enough CST."
      : amount > MAX_COLLATERAL * 8n || (preview && amount > preview.maxNewAmount)
        ? "This amount exceeds capacity after carried funds are included."
        : amount > 0n && previewQuery.error
          ? "Funding preview is unavailable. Refresh before sending CST."
          : null);
  const ready =
    live && amount > 0n && !!preview?.canFund && !previewQuery.isFetching && !error && acknowledged;
  const distributeLabel = snapshot.funded
    ? trigger || held > 0n
      ? `Distribute ${formatCst(trigger?.totalFunding ?? held)} CST now`
      : "Distribute held CST now"
    : "Open pools now";
  return (
    <Card className="p-5" data-testid="independent-funding-panel">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
        <Layers3 className="size-4 text-signal" aria-hidden /> Fund all eight pools
      </h2>
      <p className="mt-2 text-xs leading-5 text-ink-dim">
        Every contribution is divided equally across eight independent questions. Unclaimed old
        winnings remain separately reserved.
      </p>
      {!live ? (
        <p className="mt-4 text-sm text-ink-dim">
          Funding is closed for this cycle. CST sent to the market now waits and joins the next
          cycle’s pools when they open.
        </p>
      ) : (
        <>
          <div className="mt-4 rounded-xl border border-line p-3" data-testid="funding-waiting">
            <dl className="space-y-2 text-xs">
              {!snapshot.funded && (
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-dim">Carried CST waiting</dt>
                  <dd className="font-mono" data-testid="funding-available-carry">
                    {formatCst(snapshot.funding?.availableCarry ?? snapshot.availableCarry)} CST
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <dt className="text-ink-dim">Held contributions waiting</dt>
                <dd className="font-mono" data-testid="funding-held">
                  {formatCst(held)} CST
                </dd>
              </div>
            </dl>
            {connected && (
              <Button
                className="mt-3 w-full"
                variant="ghost"
                size="sm"
                disabled={!trigger || !!actions.pending}
                loading={actions.pending === "Pool distribution"}
                onClick={() => void actions.distribute()}
                aria-describedby="independent-trigger-explanation"
              >
                {distributeLabel}
              </Button>
            )}
            <p
              id="independent-trigger-explanation"
              className="mt-2 break-words text-[11px] leading-5 text-ink-faint"
              data-testid="trigger-explanation"
            >
              {triggerExplanation(snapshot)}
            </p>
          </div>
          <label htmlFor="independent-fund-amount" className="mb-2 mt-4 block text-xs text-ink-dim">
            New CST to add
          </label>
          <input
            id="independent-fund-amount"
            inputMode="decimal"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="0"
            className={fieldClass}
            disabled={!!actions.pending}
            aria-invalid={!!error}
          />
          <p role={error ? "alert" : undefined} className="mt-2 min-h-4 text-xs text-lower">
            {error}
          </p>
          {breakdown && preview && (
            <>
              <dl className="my-3 space-y-1 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-dim">Carried CST included</dt>
                  <dd className="font-mono" data-testid="funding-carry">
                    {formatCst(breakdown.carry)} CST
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-dim">Held contributions included</dt>
                  <dd className="font-mono" data-testid="funding-held-included">
                    {formatCst(breakdown.held)} CST
                  </dd>
                </div>
              </dl>
              <p className="mb-3 break-words text-xs text-ink-dim">
                Total funding: {exactCst(preview.totalFunding)} CST across all eight questions.
              </p>
              <div
                className="mb-3 grid grid-cols-2 gap-1 text-[10px] text-ink-dim"
                data-testid="funding-allocations"
              >
                {preview.allocations.map((allocation, question) => (
                  <span key={question}>
                    Q{question + 1}: {exactCst(allocation)} CST
                  </span>
                ))}
              </div>
              {!snapshot.funded && (
                <p className="mb-3 text-xs leading-5 text-ink-dim">
                  This gift opens this cycle’s pools
                  {preview.needsSettlement
                    ? ", first settling the preceding funded cycle and reserving its unpaid winnings"
                    : ""}
                  .
                </p>
              )}
              {preview.deferredCarry > 0n && (
                <p className="mb-3 break-all text-xs leading-5 text-ink-dim">
                  {exactCst(preview.deferredCarry)} CST stays carried for a later cycle because this
                  funding has reached its capacity.
                </p>
              )}
            </>
          )}
          {amount > 0n && (
            <label className="mb-4 flex items-start gap-3 text-xs leading-5 text-ink-dim">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                disabled={!!actions.pending}
                className="mt-1 size-4 accent-cyan-400"
              />
              <span>
                New CST is an irreversible gift. I receive no shares, fees, or withdrawal rights.
              </span>
            </label>
          )}
          {!connected ? (
            <ConnectButton />
          ) : (
            <Button
              className="w-full"
              variant="outline"
              disabled={!ready || !!actions.pending}
              loading={actions.pending === "Cycle funding"}
              onClick={async () => {
                if (!ready) return;
                if (approval) await actions.approve(amount);
                else if (await actions.fund(amount)) {
                  setInput("");
                  setAcknowledged(false);
                }
              }}
            >
              {approval ? "Approve CST for funding" : "Add CST to all eight pools"}
            </Button>
          )}
          <p className="mt-3 text-[11px] leading-5 text-ink-faint">
            A gift also sweeps every held contribution in with it. The first funding of a cycle, by
            gift or by trade, settles the preceding funded cycle if needed and includes all carried
            funds. Every question keeps its own liquidity.
          </p>
        </>
      )}
      <DirectTransferNotice market={snapshot.market} />
    </Card>
  );
}

export function IndependentSetsPanel({
  roundId,
  user,
  collaterals,
  open,
  finalized,
  connected,
  actions,
  recovery = false,
}: {
  roundId: bigint;
  user: IndependentWallet | null;
  collaterals: readonly bigint[];
  open: boolean;
  finalized: boolean;
  connected: boolean;
  actions: IndependentActions;
  recovery?: boolean;
}) {
  const [question, setQuestion] = useState<QuestionId>(0);
  const [split, setSplit] = useState(!recovery);
  const [input, setInput] = useState("");
  const pairs = user ? matchedSets(user.yes, user.no) : Array<bigint>(8).fill(0n);
  const amount = parseCstInput(input);
  const value = amount.value ?? 0n;
  const canSplit = !recovery && open && !finalized;
  const approval = split && value > (user?.allowance ?? 0n);
  const error =
    amount.error ??
    (split && user && value > user.balance
      ? "Not enough CST."
      : !split && value > pairs[question]
        ? "Not enough matching YES and NO in this question."
        : split && value + collaterals[question] > MAX_COLLATERAL
          ? "This question’s collateral limit would be exceeded."
          : null);
  const valid = value > 0n && !error && (!split || canSplit);
  const totalPairs = pairs.reduce((sum, pair) => sum + pair, 0n);
  return (
    <Card className="p-5" data-testid="independent-sets-panel">
      <h2 className="font-display text-lg font-semibold">Complete sets</h2>
      <p className="mt-2 text-xs leading-5 text-ink-dim">
        1 CST ↔ 1 YES + 1 NO in the same question and cycle. Splits and merges do not change its AMM
        reserves or prices.
      </p>
      {!recovery && (
        <div className="my-4 grid grid-cols-2 gap-1 rounded-xl bg-void/70 p-1">
          {[true, false].map((mode) => (
            <button
              key={String(mode)}
              aria-pressed={split === mode}
              disabled={!!actions.pending}
              onClick={() => {
                setSplit(mode);
                setInput("");
              }}
              className={`rounded-lg py-2 text-sm ${split === mode ? "bg-surface-2 text-ink" : "text-ink-dim"}`}
            >
              {mode ? "Split CST" : "Merge pairs"}
            </button>
          ))}
        </div>
      )}
      <label htmlFor="independent-set-question" className="mb-2 mt-4 block text-xs text-ink-dim">
        Question · cycle {roundId.toString()}
      </label>
      <select
        id="independent-set-question"
        value={question}
        onChange={(event) => {
          setQuestion(Number(event.target.value) as QuestionId);
          setInput("");
        }}
        className={fieldClass}
        disabled={!!actions.pending}
      >
        {QUESTIONS.map((item, i) => (
          <option key={i} value={i}>
            {i + 1}. {item.title}
          </option>
        ))}
      </select>
      <p className="my-3 text-xs text-ink-dim">
        Matched pairs:{" "}
        <span className="font-mono text-ink" data-testid="independent-matched-pairs">
          {formatCst(pairs[question])}
        </span>
      </p>
      <div className="mb-2 flex justify-between text-xs text-ink-dim">
        <label htmlFor="independent-set-amount">{split ? "CST to split" : "Pairs to merge"}</label>
        {!split && pairs[question] > 0n && (
          <button
            onClick={() => setInput(exactCst(pairs[question]))}
            className="text-signal-bright"
            disabled={!!actions.pending}
          >
            Use maximum
          </button>
        )}
      </div>
      <input
        id="independent-set-amount"
        value={input}
        onChange={(event) => setInput(event.target.value)}
        inputMode="decimal"
        placeholder="0.00"
        className={fieldClass}
        disabled={!!actions.pending}
        aria-invalid={!!error}
      />
      <p role={error ? "alert" : undefined} className="mt-2 min-h-4 text-xs text-lower">
        {error}
      </p>
      {value > 0n && (
        <p className="my-3 break-all text-xs text-ink-dim" data-testid="independent-set-output">
          {split
            ? `Receive ${exactCst(value)} YES + ${exactCst(value)} NO.`
            : `Receive exactly ${exactCst(value)} CST.`}
        </p>
      )}
      {split && !canSplit && (
        <p className="my-3 text-xs text-ended">
          Splitting is closed. Matching pairs can still be merged.
        </p>
      )}
      {!connected ? (
        <ConnectButton />
      ) : (
        <Button
          className="w-full"
          variant="outline"
          disabled={!valid || !!actions.pending}
          onClick={async () => {
            if (!valid) return;
            if (approval) await actions.approve(value);
            else if (
              await (split ? actions.split(question, value) : actions.merge(question, value))
            )
              setInput("");
          }}
        >
          {approval
            ? "Approve CST to split"
            : split
              ? "Split into YES + NO"
              : "Merge pairs into CST"}
        </Button>
      )}
      <div className="mt-5 border-t border-line pt-4">
        <p className="mb-3 text-xs text-ink-dim" data-testid="independent-all-pairs">
          Merge all returns exactly {exactCst(totalPairs)} CST.
        </p>
        <Button
          className="w-full"
          variant="ghost"
          disabled={!connected || totalPairs === 0n || !!actions.pending}
          onClick={() => user && void actions.mergeAll(matchedSets(user.yes, user.no))}
        >
          Merge all matched pairs
        </Button>
      </div>
    </Card>
  );
}

export function IndependentPortfolio({
  snapshot,
  actions,
  onSell,
}: {
  snapshot: IndependentSnapshot;
  actions: IndependentActions;
  onSell: (question: QuestionId, yes: boolean) => void;
}) {
  const [transfer, setTransfer] = useState<{ question: QuestionId; yes: boolean } | null>(null);
  const user = snapshot.user;
  if (!user) return null;
  // Indicative values use the pools the next sale would meet.
  const valuation = independentPortfolioValue({
    ...snapshot,
    questions: effectiveQuestions(snapshot),
  });
  const positions = QUESTIONS.flatMap((item, question) =>
    [true, false].flatMap((yes) => {
      const amount = yes ? user.yes[question] : user.no[question];
      return amount > 0n
        ? [{ question: question as QuestionId, yes, amount, title: item.title }]
        : [];
    }),
  );
  return (
    <Card className="p-5" data-testid="independent-portfolio">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
        <Wallet className="size-4 text-signal" aria-hidden /> Your positions
      </h2>
      {positions.length === 0 ? (
        <p className="mt-4 text-sm text-ink-dim">No positions in this cycle.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {positions.map((position) => (
            <li
              key={`${position.question}-${position.yes}`}
              className="flex items-center justify-between gap-3 py-3"
            >
              <div>
                <p className="text-xs text-ink-dim">{position.title}</p>
                <p
                  className={`mt-1 font-mono text-sm ${position.yes ? "text-higher" : "text-lower"}`}
                >
                  {formatCst(position.amount)} {position.yes ? "YES" : "NO"}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                {!snapshot.finalized && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!snapshot.open || !!actions.pending}
                    onClick={() => onSell(position.question, position.yes)}
                  >
                    Sell <ArrowUpRight className="size-3" aria-hidden />
                  </Button>
                )}
                {snapshot.finalized && (
                  <span className="text-xs text-ink-dim">
                    {answerYes(snapshot.values, position.question) === position.yes
                      ? "1 CST per unit"
                      : "Resolved · 0 CST"}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Transfer ${position.yes ? "YES" : "NO"}: ${position.title}`}
                  disabled={!!actions.pending}
                  onClick={() => setTransfer({ question: position.question, yes: position.yes })}
                >
                  Transfer
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {transfer && (
        <TransferPositionPanel
          key={`${transfer.question}-${transfer.yes}`}
          roundId={snapshot.roundId}
          question={transfer.question}
          yes={transfer.yes}
          available={transfer.yes ? user.yes[transfer.question] : user.no[transfer.question]}
          market={snapshot.market}
          sender={user.owner}
          pending={actions.pending}
          onTransfer={actions.transfer}
          onCancel={() => setTransfer(null)}
        />
      )}
      <dl className="mt-4 space-y-2 border-t border-line pt-4 text-xs">
        <div className="flex justify-between">
          <dt className="text-ink-dim">Matched pairs</dt>
          <dd className="font-mono">{formatCst(valuation.matched)} CST</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink-dim">Indicative value</dt>
          <dd className="font-mono">
            {valuation.indicative === null
              ? "Unavailable"
              : `${formatCst(valuation.indicative)} CST`}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink-dim">Available to retrieve</dt>
          <dd className="font-mono text-higher" data-testid="independent-claimable">
            {formatCst(winningClaims(user, snapshot.finalized, snapshot.values))} CST
          </dd>
        </div>
      </dl>
      <Button
        className="mt-4 w-full"
        variant="outline"
        disabled={!snapshot.finalized || positions.length === 0 || !!actions.pending}
        loading={actions.pending === "Winnings retrieval"}
        onClick={() => void actions.claim()}
      >
        <ArrowDownLeft className="size-4" aria-hidden />{" "}
        {snapshot.finalized && valuation.claimable === 0n && positions.length > 0
          ? "Clear resolved positions"
          : "Retrieve winnings"}
      </Button>
      <p className="mt-3 text-[11px] leading-5 text-ink-faint">
        Winning units pay 1 CST after cycle closure. Old claims are reserved separately and never
        draw from a new cycle’s pools. Indicative sale values are not executable quotes.
      </p>
    </Card>
  );
}
