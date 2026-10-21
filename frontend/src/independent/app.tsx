"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, FlaskConical, RefreshCw } from "lucide-react";
import { formatEther, type Address } from "viem";
import { useConnection, useChainId } from "wagmi";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { appConfig, resolveRoundOverride } from "@/lib/config";
import { formatCst, shortAddress } from "@/lib/format";
import { formatDuration } from "@/shared/question-metrics";
import { QUESTIONS, type QuestionId } from "@/shared/questions";
import { independentMarketAddress } from "./config";
import { PrelaunchMarkets } from "./prelaunch";
import { isMarketChain } from "./deployment";
import { LOCAL_DIRECT_TRANSFER, MIN_AUTO_TOP_UP } from "./models";
import {
  IndependentFundingPanel,
  IndependentPortfolio,
  IndependentQuestionCard,
  IndependentSetsPanel,
  IndependentTradePanel,
} from "./components";
import { useIndependentActions } from "./use-independent-actions";
import { useIndependentMarket, useIndependentRecovery } from "./use-independent-market";
import { IndependentRecoveryPanel } from "./recovery";

export function IndependentGate() {
  const params = useSearchParams();
  if (!isMarketChain(appConfig.chain.id)) return <p role="alert">This network is not supported.</p>;
  if (!independentMarketAddress) return <PrelaunchMarkets />;
  return (
    <IndependentDashboard
      market={independentMarketAddress}
      override={resolveRoundOverride(params.get("round"))}
    />
  );
}

export function IndependentDashboard({
  market,
  override,
}: {
  market: Address;
  override: bigint | null;
}) {
  const query = useIndependentMarket(market, override);
  const snapshot = query.data;
  const connection = useConnection();
  const chainId = useChainId();
  const path = usePathname();
  const [manualRound, setManualRound] = useState<bigint | null>(null);
  const recoveryRound = manualRound ?? override ?? snapshot?.roundId ?? null;
  const recovery = useIndependentRecovery(market, recoveryRound, !!query.error);
  const recoveryContext =
    query.error &&
    recovery.data &&
    !recovery.error &&
    !recovery.isFetching &&
    recovery.data.roundId === recoveryRound &&
    recovery.data.market.toLowerCase() === market.toLowerCase() &&
    recovery.data.user.owner.toLowerCase() === connection.address?.toLowerCase()
      ? recovery.data
      : undefined;
  const actions = useIndependentActions(
    market,
    query.error ? undefined : snapshot,
    recoveryContext,
  );
  const [question, setQuestion] = useState<QuestionId>(0);
  const [yes, setYes] = useState(true);
  const [buy, setBuy] = useState(true);
  const connected = connection.status === "connected" && chainId === appConfig.chain.id;
  if (query.error)
    return (
      <div>
        <Card accent="ended" className="p-8">
          <h2 className="font-display text-xl font-semibold">Market data unavailable</h2>
          <p className="mt-3 break-words text-sm text-ink-dim">{query.error.message}</p>
          <Button variant="outline" className="mt-4" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </Card>
        <IndependentRecoveryPanel
          key={`${market}-${recoveryRound}-${connection.address}`}
          market={market}
          owner={connection.address}
          roundId={recoveryRound}
          onRound={setManualRound}
          query={recovery}
          actions={actions}
          connected={connected}
        />
      </div>
    );
  if (!snapshot)
    return (
      <Card className="p-8">
        <p role="status" className="text-sm text-ink-dim">
          Reading eight independent pools and their claim reserves…
        </p>
      </Card>
    );
  const select = (q: QuestionId, side: boolean, mode: boolean) => {
    setQuestion(q);
    setYes(side);
    setBuy(mode);
    const panel = document.getElementById("independent-trade");
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
          {snapshot.roundId > 1n && (
            <Link
              href={`${path}?round=${snapshot.roundId - 1n}`}
              aria-label="Previous cycle"
              className="rounded-lg border border-line p-2"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </Link>
          )}
          <span className="font-display text-lg font-semibold" data-testid="independent-cycle">
            Cycle {snapshot.roundId.toString()}
          </span>
          {snapshot.roundId < snapshot.currentRound && (
            <Link
              href={`${path}?round=${snapshot.roundId + 1n}`}
              aria-label="Next cycle"
              className="rounded-lg border border-line p-2"
            >
              <ChevronRight className="size-4" aria-hidden />
            </Link>
          )}
          {override !== null && (
            <Link href={path} className="text-xs text-signal-bright">
              Follow current cycle
            </Link>
          )}
        </nav>
        <div className="flex items-center gap-3">
          <span className="text-xs text-ink-dim">
            {snapshot.settled
              ? "Settled · claims reserved"
              : snapshot.finalized
                ? "Cycle closed · settlement ready"
                : snapshot.open
                  ? appConfig.chain.id === 31337
                    ? "Local cycle open"
                    : "Cycle open"
                  : "Waiting"}
          </span>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Refresh market"
            loading={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          {
            label: "Allocated pool CST",
            value: `${formatCst(snapshot.poolCustody)} CST`,
            id: "independent-active",
          },
          {
            label: "Reserved for unpaid claims",
            value: `${formatCst(snapshot.claimEscrow)} CST`,
            id: "independent-escrow",
          },
          {
            label: "Waiting to enter pools",
            value: `${formatCst(snapshot.pendingCarry + snapshot.heldContributions)} CST`,
            id: "independent-waiting",
            detail: [
              {
                label: "Carried from settled cycles",
                value: snapshot.pendingCarry,
                id: "independent-carry",
              },
              {
                label: "Held contributions",
                value: snapshot.heldContributions,
                id: "independent-held",
              },
            ],
          },
          {
            label: appConfig.chain.id === 31337 ? "Your test CST" : "Your CST",
            value: connected && snapshot.user ? formatCst(snapshot.user.balance) : "Connect wallet",
            id: "independent-wallet",
          },
        ].map((item) => (
          <Card key={item.id} className="p-4">
            <p className="text-[11px] text-ink-dim">{item.label}</p>
            <p
              className="mt-2 font-display text-base font-semibold sm:text-lg"
              data-testid={item.id}
            >
              {item.value}
            </p>
            {item.detail && (
              <dl className="mt-2 space-y-1 text-[11px] text-ink-dim">
                {item.detail.map((row) => (
                  <div key={row.id} className="flex justify-between gap-2">
                    <dt>{row.label}</dt>
                    <dd className="font-mono" data-testid={row.id}>
                      {formatCst(row.value)} CST
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>
        ))}
      </div>
      {snapshot.heldContributions > 0n && (
        <p
          className="-mt-3 text-[11px] leading-5 text-ink-faint"
          data-testid="independent-held-note"
        >
          Held contributions are CST sent straight to the market. They join all eight pools with the
          next trade on a trading cycle or when anyone distributes them (under{" "}
          {formatCst(MIN_AUTO_TOP_UP)} CST waits for a gift); otherwise they join the next cycle’s
          pools when they open.
        </p>
      )}
      {snapshot.finalized && (
        <Card accent="higher" className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="max-w-2xl text-sm leading-6 text-ink-dim">
            {snapshot.settled
              ? "This cycle’s trading pools are cleared. Unpaid winning claims remain reserved separately; all surplus is carried forward."
              : "The game cycle has closed. Settlement secures every winning claim at 1 CST per unit and carries all remaining CST forward."}
          </p>
          {!snapshot.settled && (
            <Button
              variant="outline"
              disabled={!connected || !!actions.pending}
              onClick={() => void actions.settle()}
            >
              Settle this cycle
            </Button>
          )}
        </Card>
      )}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div>
          <div className="grid gap-4 sm:grid-cols-2">
            {QUESTIONS.map((_, i) => (
              <IndependentQuestionCard
                key={`${snapshot.roundId}-${i}`}
                question={i as QuestionId}
                snapshot={snapshot}
                selected={question === i}
                onSelect={(side) => select(i as QuestionId, side, true)}
              />
            ))}
          </div>
          <p className="mt-4 text-xs leading-5 text-ink-faint">
            Each trade uses its question’s own pool; funding is shared equally. Comparisons may
            become clear early, but trading and claims follow full cycle closure. Starting odds use
            the same 50% YES / 50% NO opening price for every new cycle.
          </p>
          {appConfig.chain.id === 31337 && snapshot.local && (
            <Card accent="ended" className="mt-6 p-5" data-testid="independent-local-controls">
              <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
                <FlaskConical className="size-4 text-ended" aria-hidden /> Local game controls
              </h2>
              <p className="mt-2 text-xs leading-5 text-ink-dim">
                Test CST and shortened cycle durations let you explore independent prices, carry,
                and later claims. A direct transfer is a plain ERC-20 send with no market call, so
                it stays held until a trade or a Distribute absorbs it.
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
                  disabled={
                    !connected ||
                    !!actions.pending ||
                    (snapshot.user?.balance ?? 0n) < LOCAL_DIRECT_TRANSFER
                  }
                  onClick={() => void actions.local("direct")}
                >
                  Send {formatCst(LOCAL_DIRECT_TRANSFER)} test CST directly to the market
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
                  ? "The current game cycle starts with an ETH gesture."
                  : snapshot.timestamp >= snapshot.local.deadline
                    ? "The countdown has elapsed. Trading stays open until the cycle is closed. The last participant can close now; others wait for the timeout."
                    : `${formatDuration(snapshot.local.deadline - snapshot.timestamp)} until this game cycle can close.`}
              </p>
            </Card>
          )}
          <div className="mt-5 flex flex-wrap gap-4 break-all font-mono text-[10px] text-ink-faint">
            <span title={market}>Market {shortAddress(market)}</span>
            <span title={snapshot.vault}>Claim vault {shortAddress(snapshot.vault)}</span>
            <span title={snapshot.token}>CST {shortAddress(snapshot.token)}</span>
          </div>
        </div>
        <aside
          id="independent-trade"
          tabIndex={-1}
          className="scroll-mt-5 space-y-4 focus:outline-none xl:sticky xl:top-5"
        >
          <IndependentTradePanel
            key={`${snapshot.roundId}-${question}-${connection.address}`}
            snapshot={snapshot}
            question={question}
            yes={yes}
            buy={buy}
            connected={connected}
            actions={actions}
            onSide={setYes}
            onMode={setBuy}
          />
          {connected && (
            <IndependentPortfolio
              key={`positions-${snapshot.roundId}-${connection.address}`}
              snapshot={snapshot}
              actions={actions}
              onSell={(q, side) => select(q, side, false)}
            />
          )}
          <IndependentSetsPanel
            key={`sets-${snapshot.roundId}-${connection.address}`}
            roundId={snapshot.roundId}
            user={snapshot.user}
            collaterals={snapshot.questions.map((q) => q.pool.collateral)}
            open={snapshot.open}
            finalized={snapshot.finalized}
            connected={connected}
            actions={actions}
          />
          <IndependentFundingPanel
            key={`fund-${snapshot.roundId}-${connection.address}`}
            snapshot={snapshot}
            connected={connected}
            actions={actions}
          />
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
