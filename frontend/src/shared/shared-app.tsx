"use client";

import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  Layers3,
  RefreshCw,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { formatEther, type Address } from "viem";
import { useChainId, useConnection } from "wagmi";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConnectButton } from "@/components/wallet/connect-button";
import { appConfig, resolveRoundOverride } from "@/lib/config";
import { formatCst, parseCstInput, shortAddress } from "@/lib/format";
import { sharedMarketAddress } from "./config";
import { claimable, MAX_COLLATERAL, MIN_FUNDING, quoteTrade, yesProbabilityBps } from "./math";
import { answerYes, questionKnown, QUESTIONS, type QuestionId } from "./questions";
import {
  useSharedActions,
  useSharedMarket,
  type CycleStats,
  type SharedSnapshot,
} from "./use-shared-market";

const inputClass =
  "h-12 w-full rounded-xl border border-line-strong bg-void/70 px-4 font-mono text-lg text-ink outline-none focus:border-signal focus:ring-1 focus:ring-signal disabled:opacity-50";
const countKnown = (mask: number) => QUESTIONS.filter((_, i) => questionKnown(mask, i)).length;
const percent = (bps: bigint | null) =>
  bps === null
    ? "—"
    : `${(Number(bps) / 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
export const duration = (seconds: bigint) => {
  const hours = seconds / 3600n;
  const minutes = (seconds % 3600n) / 60n;
  return hours > 0n
    ? `${hours}h ${minutes}m`
    : minutes > 0n
      ? `${minutes}m ${seconds % 60n}s`
      : `${seconds}s`;
};

function metricValue(stats: CycleStats | null | undefined, question: number): string {
  if (!stats) return "—";
  switch (question) {
    case 0:
      return stats.gestureCount.toLocaleString();
    case 1:
      return duration(stats.enduranceDuration);
    case 2:
      return duration(stats.chronoDuration);
    case 3:
      return `${Number(formatEther(stats.ethSpent)).toLocaleString("en-US", { maximumFractionDigits: 6 })} ETH`;
    case 4:
      return `${formatCst(stats.cstBurned)} CST`;
    case 5:
      return `${stats.cstGestureCount} CST / ${stats.ethGestureCount} ETH`;
    case 6:
      return stats.gestureCount === 0n
        ? "No gestures yet"
        : `#${stats.enduranceGesture} / #${stats.chronoGesture}`;
    case 7:
      return `${formatCst(stats.highestCstPaid)} CST`;
    default:
      return "—";
  }
}

export function SharedGate() {
  const params = useSearchParams();
  if (appConfig.chain.id !== 31337)
    return (
      <Card className="p-8" accent="ended">
        <h2 className="font-display text-xl font-semibold">Local prototype only</h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-dim">
          The eight-question market is available on the local test network. Public-chain trading
          stays disabled until a verified live outcome source is integrated.
        </p>
        <Link href="/" className="mt-5 inline-flex items-center gap-2 text-sm text-signal-bright">
          Open the existing market <ArrowRight className="size-4" aria-hidden />
        </Link>
      </Card>
    );
  if (!sharedMarketAddress)
    return (
      <Card className="p-8" accent="signal">
        <h2 className="font-display text-xl font-semibold">Shared market not configured</h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-dim">
          Start the local shared-market workspace to connect this screen to its deployed simulator
          and test CST pool. The existing single-question deployment is separate.
        </p>
        <Link href="/" className="mt-5 inline-flex items-center gap-2 text-sm text-signal-bright">
          Open the existing market <ArrowRight className="size-4" aria-hidden />
        </Link>
      </Card>
    );
  return (
    <SharedDashboard
      market={sharedMarketAddress}
      roundOverride={resolveRoundOverride(params.get("round"))}
    />
  );
}

export function QuestionCard({
  question,
  snapshot,
  selected,
  onSelect,
}: {
  question: QuestionId;
  snapshot: SharedSnapshot;
  selected: boolean;
  onSelect: (yes: boolean) => void;
}) {
  const item = QUESTIONS[question];
  const known = questionKnown(snapshot.pool.knownMask, question);
  const won = answerYes(snapshot.pool.values, question);
  const probability = yesProbabilityBps(snapshot.pool, question);
  return (
    <Card
      accent={known ? (won ? "higher" : "lower") : selected ? "signal" : "none"}
      className={`flex flex-col p-5 ${selected ? "ring-1 ring-signal/50" : ""}`}
      data-testid={`question-${question}`}
    >
      <div className="mb-4 flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-ink-faint">
          {String(question + 1).padStart(2, "0")}
        </span>
        <span
          className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${known ? (won ? "bg-higher/10 text-higher" : "bg-lower/10 text-lower") : "bg-signal/10 text-signal-bright"}`}
        >
          {known ? `Resolved ${won ? "YES" : "NO"}` : snapshot.open ? "Open" : "Waiting"}
        </span>
      </div>
      <h2 className="font-display text-lg font-semibold tracking-tight">{item.title}</h2>
      <p className="mt-2 min-h-10 text-xs leading-5 text-ink-dim">{item.question}</p>
      <div className="my-4 grid grid-cols-2 gap-3 border-y border-line py-3 text-xs">
        <div>
          <p className="mb-1 text-ink-faint">
            {question === 6 ? "Endurance / Chrono" : "This cycle"}
          </p>
          <p className="font-mono text-ink" data-testid={`current-${question}`}>
            {metricValue(snapshot.local?.current, question)}
          </p>
        </div>
        <div>
          <p className="mb-1 text-ink-faint">
            {question === 5 ? "Condition" : question === 6 ? "Condition" : "Previous cycle"}
          </p>
          <p className="font-mono text-ink">
            {question === 5
              ? "CST > ETH"
              : question === 6
                ? "Same gesture"
                : metricValue(snapshot.local?.previous, question)}
          </p>
        </div>
      </div>
      <div className="mt-auto grid grid-cols-2 gap-2">
        <button
          aria-label={`Buy YES: ${item.title}`}
          disabled={known || !snapshot.open}
          onClick={() => onSelect(true)}
          className="flex min-h-11 items-center justify-between rounded-xl border border-higher/25 bg-higher/5 px-3 text-sm font-semibold text-higher transition-colors hover:bg-higher/15 focus-visible:outline-2 focus-visible:outline-higher disabled:cursor-default disabled:opacity-65"
        >
          <span>YES</span>
          <span className="font-mono">{percent(probability)}</span>
        </button>
        <button
          aria-label={`Buy NO: ${item.title}`}
          disabled={known || !snapshot.open}
          onClick={() => onSelect(false)}
          className="flex min-h-11 items-center justify-between rounded-xl border border-lower/25 bg-lower/5 px-3 text-sm font-semibold text-lower transition-colors hover:bg-lower/15 focus-visible:outline-2 focus-visible:outline-lower disabled:cursor-default disabled:opacity-65"
        >
          <span>NO</span>
          <span className="font-mono">
            {percent(probability === null ? null : 10_000n - probability)}
          </span>
        </button>
      </div>
      <details className="mt-3 text-xs leading-5 text-ink-dim">
        <summary className="cursor-pointer text-ink-faint hover:text-ink">Settlement rule</summary>
        <p className="pt-2">{item.detail}</p>
      </details>
    </Card>
  );
}

export interface TradePanelProps {
  snapshot: SharedSnapshot;
  question: QuestionId;
  yes: boolean;
  buy: boolean;
  connected: boolean;
  pending: string | null;
  onSide: (yes: boolean) => void;
  onMode: (buy: boolean) => void;
  onApprove: (amount: bigint) => Promise<boolean>;
  onTrade: (input: bigint, output: bigint) => Promise<boolean>;
}

function safeQuote(
  pool: SharedSnapshot["pool"],
  question: number,
  yes: boolean,
  buy: boolean,
  amount: bigint | null,
  enabled: boolean,
) {
  if (!amount || !enabled) return 0n;
  try {
    return quoteTrade(pool, question, yes, buy, amount);
  } catch {
    return 0n;
  }
}

export function TradePanel({
  snapshot,
  question,
  yes,
  buy,
  connected,
  pending,
  onSide,
  onMode,
  onApprove,
  onTrade,
}: TradePanelProps) {
  const [input, setInput] = useState("");
  const parsed = parseCstInput(input);
  const known = questionKnown(snapshot.pool.knownMask, question);
  const balance = buy
    ? snapshot.user?.balance
    : yes
      ? snapshot.user?.yes[question]
      : snapshot.user?.no[question];
  const [computed, setComputed] = useState<{ key: string; value: bigint } | null>(null);
  const quoteEnabled = !known && snapshot.open && snapshot.funded && parsed.value !== null;
  const quoteKey = `${snapshot.roundId}:${snapshot.pool.collateral}:${snapshot.pool.yes.join(",")}:${snapshot.pool.no.join(",")}:${snapshot.pool.knownMask}:${snapshot.pool.values}:${question}:${yes}:${buy}:${parsed.value}:${quoteEnabled}`;
  useEffect(() => {
    if (!quoteEnabled) return;
    const timer = setTimeout(() => {
      const value = safeQuote(snapshot.pool, question, yes, buy, parsed.value, true);
      setComputed({ key: quoteKey, value });
    }, 180);
    return () => clearTimeout(timer);
  }, [quoteKey, quoteEnabled, snapshot.pool, question, yes, buy, parsed.value]);
  const quotePending = quoteEnabled && computed?.key !== quoteKey;
  const quote = !quotePending && quoteEnabled && computed?.key === quoteKey ? computed.value : 0n;
  const amount = parsed.value ?? 0n;
  const needsApproval = buy && amount > (snapshot.user?.allowance ?? 0n);
  const problem =
    parsed.error ??
    (amount > 0n && balance !== undefined && amount > balance
      ? `Not enough ${buy ? "CST" : `${yes ? "YES" : "NO"} units`}.`
      : amount > 0n && quote === 0n && !quotePending && snapshot.funded && !known
        ? "This amount has no executable quote."
        : null);
  const ready = amount > 0n && quote > 0n && !problem && snapshot.open && snapshot.funded && !known;
  const displayedBalance = balance === undefined ? "—" : formatCst(balance);
  return (
    <Card className="p-5" accent="signal" data-testid="shared-trade-panel">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">Trade a position</h2>
        <span className="rounded-full border border-line px-2 py-1 text-[10px] text-ink-dim">
          No trading fee
        </span>
      </div>
      <p className="mb-4 text-sm font-medium text-ink">{QUESTIONS[question].question}</p>
      <div
        className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-void/70 p-1"
        aria-label="Trade direction"
      >
        {[true, false].map((mode) => (
          <button
            key={String(mode)}
            aria-pressed={buy === mode}
            onClick={() => {
              onMode(mode);
              setInput("");
            }}
            className={`rounded-lg py-2 text-sm font-medium ${buy === mode ? "bg-surface-2 text-ink" : "text-ink-dim"}`}
          >
            {mode ? "Buy" : "Sell"}
          </button>
        ))}
      </div>
      <div className="mb-5 grid grid-cols-2 gap-2" aria-label="Outcome">
        {[true, false].map((side) => (
          <button
            key={String(side)}
            aria-pressed={yes === side}
            onClick={() => onSide(side)}
            className={`rounded-xl border py-2.5 text-sm font-semibold ${yes === side ? (side ? "border-higher bg-higher/15 text-higher" : "border-lower bg-lower/15 text-lower") : "border-line text-ink-dim"}`}
          >
            {side ? "YES" : "NO"}
          </button>
        ))}
      </div>
      {known ? (
        <p className="rounded-xl bg-surface-2 p-4 text-sm text-ink-dim">
          This answer is known. Retrieve winning positions from your portfolio.
        </p>
      ) : !snapshot.open ? (
        <p className="rounded-xl bg-surface-2 p-4 text-sm text-ink-dim">
          Trading is closed for this cycle.
        </p>
      ) : !snapshot.funded ? (
        <p className="rounded-xl bg-surface-2 p-4 text-sm text-ink-dim">
          This cycle needs its first pool gift before trading can begin.
        </p>
      ) : (
        <>
          <label
            htmlFor="shared-trade-amount"
            className="mb-2 flex items-center justify-between gap-2 text-xs text-ink-dim"
          >
            <span>{buy ? "CST to spend" : "Position units to sell"}</span>
            <span>Balance {displayedBalance}</span>
          </label>
          <input
            id="shared-trade-amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            className={inputClass}
            aria-invalid={!!problem}
            aria-describedby="shared-trade-feedback"
            disabled={!!pending}
          />
          <div
            id="shared-trade-feedback"
            className="min-h-6 pt-2 text-xs text-lower"
            role={problem ? "alert" : undefined}
          >
            {problem}
          </div>
          <dl className="my-4 space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-dim">You receive</dt>
              <dd className="font-mono" data-testid="trade-output">
                {quotePending
                  ? "Calculating…"
                  : quote > 0n
                    ? formatCst(quote, { decimals: 6 })
                    : "—"}{" "}
                {buy ? `${yes ? "YES" : "NO"} units` : "CST"}
              </dd>
            </div>
            {buy && (
              <div className="flex justify-between">
                <dt className="text-ink-dim">If correct</dt>
                <dd className="font-mono text-higher">
                  {quote > 0n ? `${formatCst(quote, { decimals: 6 })} CST` : "—"}
                </dd>
              </div>
            )}
          </dl>
          {!connected ? (
            <div className="flex justify-center">
              <ConnectButton />
            </div>
          ) : (
            <Button
              className="w-full"
              variant={yes ? "higher" : "lower"}
              disabled={!ready || !!pending}
              loading={!!pending && (pending === "CST approval" || pending.startsWith("Position"))}
              onClick={async () => {
                if (!ready) return;
                if (needsApproval) await onApprove(amount);
                else if (await onTrade(amount, quote)) setInput("");
              }}
            >
              {needsApproval
                ? "Approve CST to trade"
                : `${buy ? "Buy" : "Sell"} ${yes ? "YES" : "NO"}`}
            </Button>
          )}
          <p className="mt-3 text-[11px] leading-5 text-ink-faint">
            Exact amounts are checked on-chain. A changed price may require a fresh quote. Each
            winning unit pays 1 CST; a losing unit pays 0.
          </p>
        </>
      )}
    </Card>
  );
}

export function FundingPanel({
  snapshot,
  connected,
  pending,
  onApprove,
  onFund,
}: {
  snapshot: SharedSnapshot;
  connected: boolean;
  pending: string | null;
  onApprove: (amount: bigint) => Promise<boolean>;
  onFund: (amount: bigint) => Promise<boolean>;
}) {
  const [input, setInput] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const parsed = parseCstInput(input);
  const amount = parsed.value ?? 0n;
  const needsApproval = amount > (snapshot.user?.allowance ?? 0n);
  const error =
    parsed.error ??
    (!snapshot.funded && amount > 0n && amount < MIN_FUNDING
      ? "The minimum gift is 0.000001 CST."
      : amount + snapshot.pool.collateral > MAX_COLLATERAL
        ? "This gift exceeds the pool limit."
        : snapshot.user && amount > snapshot.user.balance
          ? "Not enough CST."
          : null);
  const valid =
    amount > 0n && !error && acknowledged && snapshot.open && snapshot.pool.knownMask !== 255;
  return (
    <Card className="p-5" data-testid="shared-funding-panel">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
        <Layers3 className="size-4 text-signal" aria-hidden /> Fund the shared pool
      </h2>
      <p className="mt-2 text-xs leading-5 text-ink-dim">
        One gift supports all eight questions in cycle {snapshot.roundId.toString()}. It increases
        the pool’s capacity and can move prices toward even odds.
      </p>
      {!snapshot.open || snapshot.pool.knownMask === 255 ? (
        <p className="mt-4 text-sm text-ink-dim">Funding is closed for this cycle.</p>
      ) : (
        <>
          <label htmlFor="shared-fund-amount" className="mb-2 mt-5 block text-xs text-ink-dim">
            Gift amount in CST
          </label>
          <input
            id="shared-fund-amount"
            inputMode="decimal"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="0.00"
            className={inputClass}
            disabled={!!pending}
            aria-invalid={!!error}
            aria-describedby="fund-feedback"
          />
          <p
            id="fund-feedback"
            className="mt-2 min-h-4 text-xs text-lower"
            role={error ? "alert" : undefined}
          >
            {error}
          </p>
          <label className="mb-4 mt-2 flex cursor-pointer items-start gap-3 text-xs leading-5 text-ink-dim">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              className="mt-1 size-4 shrink-0 accent-cyan-400"
            />
            <span>
              I understand this is an irreversible gift. I receive no shares, fees, or withdrawal
              rights.
            </span>
          </label>
          {!connected ? (
            <div className="flex justify-center">
              <ConnectButton />
            </div>
          ) : (
            <Button
              variant="outline"
              className="w-full"
              disabled={!valid || !!pending}
              loading={pending === "Pool gift"}
              onClick={async () => {
                if (!valid) return;
                if (needsApproval) await onApprove(amount);
                else if (await onFund(amount)) {
                  setInput("");
                  setAcknowledged(false);
                }
              }}
            >
              {needsApproval ? "Approve CST for gift" : "Gift CST to this cycle"}
            </Button>
          )}
        </>
      )}
    </Card>
  );
}

export function Portfolio({
  snapshot,
  pending,
  onClaim,
  onSell,
}: {
  snapshot: SharedSnapshot;
  pending: string | null;
  onClaim: () => Promise<boolean>;
  onSell: (question: QuestionId, yes: boolean) => void;
}) {
  const user = snapshot.user;
  if (!user) return null;
  const redeemable = claimable(user.yes, user.no, snapshot.pool.knownMask, snapshot.pool.values);
  const hasKnownPositions = QUESTIONS.some(
    (_, i) => questionKnown(snapshot.pool.knownMask, i) && (user.yes[i] > 0n || user.no[i] > 0n),
  );
  const positions = QUESTIONS.flatMap((item, question) =>
    ([true, false] as const).flatMap((yes) => {
      const amount = yes ? user.yes[question] : user.no[question];
      return amount > 0n
        ? [{ question: question as QuestionId, title: item.title, yes, amount }]
        : [];
    }),
  );
  return (
    <Card className="p-5" data-testid="shared-portfolio">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
          <Wallet className="size-4 text-signal" aria-hidden /> Your positions
        </h2>
        <span className="text-xs text-ink-dim">Cycle {snapshot.roundId.toString()}</span>
      </div>
      {positions.length === 0 ? (
        <p className="mt-5 text-sm text-ink-dim">No positions in this cycle yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {positions.map((position) => {
            const known = questionKnown(snapshot.pool.knownMask, position.question);
            const winner = answerYes(snapshot.pool.values, position.question) === position.yes;
            return (
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
                {known ? (
                  <span className={`text-xs ${winner ? "text-higher" : "text-ink-faint"}`}>
                    {winner ? "Ready to retrieve" : "Resolved · 0 CST"}
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!snapshot.open || !!pending}
                    onClick={() => onSell(position.question, position.yes)}
                  >
                    Sell <ArrowUpRight className="size-3" aria-hidden />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-4 flex items-center justify-between border-t border-line pt-4 text-sm">
        <span className="text-ink-dim">Available to retrieve</span>
        <span className="font-mono text-higher" data-testid="shared-claimable">
          {formatCst(redeemable)} CST
        </span>
      </div>
      <Button
        className="mt-4 w-full"
        variant="outline"
        disabled={!hasKnownPositions || !!pending}
        loading={pending === "Retrieval"}
        onClick={() => void onClaim()}
      >
        <ArrowDownLeft className="size-4" aria-hidden />{" "}
        {hasKnownPositions && redeemable === 0n
          ? "Clear resolved positions"
          : "Retrieve known winnings"}
      </Button>
      <p className="mt-3 text-[11px] leading-5 text-ink-faint">
        Early answers can be retrieved immediately. Your other positions stay open.
      </p>
    </Card>
  );
}

export function SharedDashboard({
  market,
  roundOverride,
}: {
  market: Address;
  roundOverride: bigint | null;
}) {
  const query = useSharedMarket(market, roundOverride);
  const snapshot = query.data;
  const actions = useSharedActions(market, snapshot);
  const connection = useConnection();
  const chainId = useChainId();
  const path = usePathname();
  const [question, setQuestion] = useState<QuestionId>(0);
  const [yes, setYes] = useState(true);
  const [buy, setBuy] = useState(true);
  const connected = connection.status === "connected" && chainId === appConfig.chain.id;
  if (query.error)
    return (
      <Card accent="ended" className="p-8">
        <h2 className="font-display text-xl font-semibold">Could not load the shared market</h2>
        <p className="mt-3 text-sm text-ink-dim">
          Check that the configured shared market and local network are running.
        </p>
        <p className="mt-2 break-words text-xs text-ink-faint">{query.error.message}</p>
        <Button onClick={() => void query.refetch()} className="mt-5" variant="outline">
          Try again
        </Button>
      </Card>
    );
  if (!snapshot)
    return (
      <div role="status" className="rounded-2xl border border-line bg-surface p-8 text-ink-dim">
        Reading the pool and all eight answers…
      </div>
    );
  const nKnown = countKnown(snapshot.pool.knownMask);
  const residual = snapshot.finalized
    ? snapshot.pool.collateral -
      claimable(snapshot.pool.yes, snapshot.pool.no, snapshot.pool.knownMask, snapshot.pool.values)
    : 0n;
  const select = (id: QuestionId, side: boolean, mode: boolean) => {
    setQuestion(id);
    setYes(side);
    setBuy(mode);
    const panel = document.getElementById("shared-trade");
    panel?.focus({ preventScroll: true });
    panel?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "start",
    });
  };
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Cycle navigation" className="flex items-center gap-3">
          {snapshot.roundId > 1n ? (
            <Link
              aria-label="Previous cycle"
              href={`${path}?round=${snapshot.roundId - 1n}`}
              className="rounded-lg border border-line p-2 text-ink-dim hover:text-ink"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </Link>
          ) : (
            <span className="rounded-lg border border-line p-2 text-ink-faint/30">
              <ChevronLeft className="size-4" aria-hidden />
            </span>
          )}
          <span className="font-display text-lg font-semibold" data-testid="shared-cycle">
            Cycle {snapshot.roundId.toString()}
          </span>
          {snapshot.roundId < snapshot.currentRound ? (
            <Link
              aria-label="Next cycle"
              href={`${path}?round=${snapshot.roundId + 1n}`}
              className="rounded-lg border border-line p-2 text-ink-dim hover:text-ink"
            >
              <ChevronRight className="size-4" aria-hidden />
            </Link>
          ) : (
            <span className="rounded-lg border border-line p-2 text-ink-faint/30">
              <ChevronRight className="size-4" aria-hidden />
            </span>
          )}
          {roundOverride !== null && (
            <Link href={path} className="text-xs text-signal-bright">
              Follow current cycle
            </Link>
          )}
        </nav>
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center gap-2 text-xs ${snapshot.finalized ? "text-ink-dim" : "text-higher"}`}
          >
            <span className="size-1.5 rounded-full bg-current" aria-hidden />
            {snapshot.finalized
              ? "Cycle closed"
              : snapshot.open
                ? "Live on local chain"
                : "Waiting for baseline"}
          </span>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Refresh market"
            loading={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw className="size-3.5" aria-hidden />
          </Button>
        </div>
      </div>
      {snapshot.pool.knownMask > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-higher/20 bg-higher/5 px-4 py-3 text-sm text-ink-dim">
          <Check className="size-4 shrink-0 text-higher" aria-hidden />
          <span>
            {nKnown} of 8 answers known.{" "}
            {snapshot.finalized
              ? "Winning positions are ready to retrieve."
              : "Other questions continue trading in the same pool."}
          </span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "CST in this pool", value: `${formatCst(snapshot.pool.collateral)} CST` },
          { label: "Questions still open", value: `${8 - nKnown} / 8` },
          {
            label: "Your test CST",
            value: snapshot.user && connected ? formatCst(snapshot.user.balance) : "Connect wallet",
          },
          { label: "Funding model", value: "Shared · no LP shares" },
        ].map((stat) => (
          <Card key={stat.label} className="p-4">
            <p className="text-[11px] text-ink-dim">{stat.label}</p>
            <p
              className="mt-2 font-display text-base font-semibold sm:text-lg"
              data-testid={stat.label === "CST in this pool" ? "shared-collateral" : undefined}
            >
              {stat.value}
            </p>
          </Card>
        ))}
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div>
          <div className="grid gap-4 sm:grid-cols-2">
            {QUESTIONS.map((_, i) => (
              <QuestionCard
                key={`${snapshot.roundId}-${i}`}
                question={i as QuestionId}
                snapshot={snapshot}
                selected={question === i}
                onSelect={(side) => select(i as QuestionId, side, true)}
              />
            ))}
          </div>
          <p className="mt-4 text-xs leading-5 text-ink-faint">
            Prices are implied by the shared pool, not forecasts supplied by Chaos Zero. Ties
            resolve NO for strict comparisons.
          </p>
          {snapshot.local && (
            <Card className="mt-6 p-5" accent="ended" data-testid="local-controls">
              <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
                <FlaskConical className="size-4 text-ended" aria-hidden /> Local game controls
              </h2>
              <p className="mt-2 text-xs leading-5 text-ink-dim">
                Use test funds and advance the simulator’s clock to explore how the answers change.
                All results come from these on-chain actions. Durations are shortened for this
                prototype.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!connected || !!actions.pending}
                  onClick={() => void actions.local("faucet")}
                >
                  Get 1,000 test CST
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!connected || !!actions.pending}
                  onClick={() => void actions.local("eth")}
                >
                  ETH gesture ·{" "}
                  {Number(formatEther(snapshot.local.ethPrice)).toLocaleString("en-US", {
                    maximumFractionDigits: 6,
                  })}{" "}
                  ETH
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!connected || !!actions.pending}
                  onClick={() => void actions.local("cst")}
                >
                  CST gesture · {formatCst(snapshot.local.cstPrice)} CST
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!actions.pending}
                  onClick={() => void actions.advance(60)}
                >
                  Advance 1 minute
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!actions.pending}
                  onClick={() => void actions.advance(3600)}
                >
                  Advance 1 hour
                </Button>
                <Button
                  size="sm"
                  variant="ended"
                  disabled={
                    !connected ||
                    !!actions.pending ||
                    snapshot.local.deadline === 0n ||
                    snapshot.timestamp < snapshot.local.deadline
                  }
                  onClick={() => void actions.local("close")}
                >
                  Close current cycle
                </Button>
              </div>
              <p className="mt-3 text-xs text-ink-faint">
                {snapshot.local.deadline === 0n
                  ? "The current cycle begins with an ETH gesture."
                  : snapshot.timestamp >= snapshot.local.deadline
                    ? "The timer has expired. The last participant can close now; other wallets must wait for the timeout."
                    : `${duration(snapshot.local.deadline - snapshot.timestamp)} until the current cycle can close.`}
              </p>
            </Card>
          )}
          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 break-all font-mono text-[10px] text-ink-faint">
            <span title={market}>Market {shortAddress(market)}</span>
            <span title={snapshot.token}>CST {shortAddress(snapshot.token)}</span>
            <span title={snapshot.game}>Game {shortAddress(snapshot.game)}</span>
            <span>Chain {appConfig.chain.id}</span>
          </div>
        </div>
        <aside
          className="scroll-mt-5 space-y-4 focus:outline-none xl:sticky xl:top-5"
          id="shared-trade"
          tabIndex={-1}
        >
          <TradePanel
            key={`${snapshot.roundId}-${question}`}
            snapshot={snapshot}
            question={question}
            yes={yes}
            buy={buy}
            connected={connected}
            pending={actions.pending}
            onSide={setYes}
            onMode={setBuy}
            onApprove={actions.approve}
            onTrade={(input, output) => actions.trade(question, yes, buy, input, output)}
          />
          {connected && (
            <Portfolio
              snapshot={snapshot}
              pending={actions.pending}
              onClaim={actions.claim}
              onSell={(id, side) => select(id, side, false)}
            />
          )}
          <FundingPanel
            key={`fund-${snapshot.roundId}`}
            snapshot={snapshot}
            connected={connected}
            pending={actions.pending}
            onApprove={actions.approve}
            onFund={actions.fund}
          />
          {snapshot.finalized && snapshot.roundId < snapshot.currentRound && (
            <Card className="p-5">
              <h2 className="font-display font-semibold">Keep the pool moving</h2>
              <p className="my-3 text-xs leading-5 text-ink-dim">
                Uncommitted sponsor funds can support the current cycle. Unpaid winning positions
                remain backed in this cycle.
              </p>
              <Button
                variant="outline"
                className="w-full"
                disabled={!connected || !!actions.pending || residual <= 0n}
                onClick={() => void actions.rollover()}
              >
                Roll remaining funds forward
              </Button>
            </Card>
          )}
          {actions.message && (
            <p
              role="status"
              className="rounded-xl border border-line bg-surface p-3 text-xs leading-5 text-ink-dim"
            >
              {actions.message}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
