"use client";

import { useState } from "react";
import type { Address } from "viem";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConnectButton } from "@/components/wallet/connect-button";
import { formatCst } from "@/lib/format";
import { CompleteSetsPanel, TransferPositionPanel } from "./complete-sets-panel";
import { MAX_ROUND_ID } from "./positions";
import { QUESTIONS, type QuestionId } from "./questions";
import type { PositionRecovery } from "./use-position-recovery";
import type { useSharedActions } from "./use-shared-market";

export function PositionRecoveryPanel({
  market,
  sender,
  roundId,
  onRound,
  query,
  actions,
  connected,
}: {
  market: Address;
  sender: Address | undefined;
  roundId: bigint | null;
  onRound: (roundId: bigint) => void;
  query: {
    data?: PositionRecovery;
    error: Error | null;
    isFetching: boolean;
    refetch: () => Promise<unknown>;
  };
  actions: ReturnType<typeof useSharedActions>;
  connected: boolean;
}) {
  const [input, setInput] = useState(roundId?.toString() ?? "");
  const [transfer, setTransfer] = useState<{ question: QuestionId; yes: boolean } | null>(null);
  const parsed = /^\d+$/.test(input) ? BigInt(input) : null;
  const validRound = parsed !== null && parsed <= MAX_ROUND_ID;
  const fresh =
    query.data &&
    !query.error &&
    query.data.roundId === roundId &&
    query.data.owner.toLowerCase() === sender?.toLowerCase()
      ? query.data
      : null;
  const recoveryPending =
    actions.pending ?? (query.isFetching ? "Refreshing position balances" : null);
  return (
    <section
      className="mt-6 space-y-4"
      aria-label="Source-independent position recovery"
      data-testid="position-recovery"
    >
      <Card className="p-5" accent="ended">
        <h2 className="font-display text-lg font-semibold">Recover owned positions</h2>
        <p className="mt-2 text-sm leading-6 text-ink-dim">
          Outcome data is unavailable. You can merge matched pairs or transfer positions using fresh
          wallet balances, without asking the outcome source. Trading, splitting, funding, and
          winner retrieval stay unavailable.
        </p>
        <label htmlFor="recovery-cycle" className="mb-2 mt-4 block text-xs text-ink-dim">
          Explicit cycle number
        </label>
        <div className="flex gap-2">
          <input
            id="recovery-cycle"
            disabled={!!recoveryPending}
            inputMode="numeric"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            className="h-10 min-w-0 flex-1 rounded-xl border border-line-strong bg-void/70 px-3 font-mono text-sm focus:border-signal focus:outline-none"
          />
          <Button
            variant="outline"
            disabled={!validRound || !!recoveryPending}
            onClick={() => {
              if (parsed !== null && validRound) {
                onRound(parsed);
                if (parsed === roundId) void query.refetch();
              }
            }}
          >
            Load cycle positions
          </Button>
        </div>
        {input && !validRound && (
          <p role="alert" className="mt-2 text-xs text-lower">
            Enter a valid non-negative cycle number.
          </p>
        )}
        {!connected && (
          <div className="mt-4">
            <ConnectButton />
          </div>
        )}
        {connected && roundId === null && (
          <p className="mt-3 text-xs text-ink-dim">
            Choose a cycle first. The current cycle cannot be inferred while outcome data is
            unavailable.
          </p>
        )}
        {query.isFetching && (
          <p role="status" className="mt-3 text-sm text-ink-dim">
            Reading fresh position balances…
          </p>
        )}
        {query.error && (
          <p role="alert" className="mt-3 text-sm text-lower">
            Position balances could not be refreshed. No recovery transaction is available.{" "}
            {query.error.message}
          </p>
        )}
      </Card>
      {fresh && connected && (
        <div className="grid gap-4 lg:grid-cols-2">
          <CompleteSetsPanel
            roundId={fresh.roundId}
            user={fresh.user}
            collateral={fresh.collateral}
            open={false}
            knownMask={null}
            connected
            pending={recoveryPending}
            mergeOnly
            onApprove={actions.approve}
            onSplit={actions.split}
            onMerge={actions.merge}
            onMergeAll={actions.mergeAll}
          />
          <Card className="p-5" data-testid="recovery-positions">
            <h3 className="font-display text-lg font-semibold">
              Wallet positions · cycle {fresh.roundId.toString()}
            </h3>
            <ul className="mt-4 divide-y divide-line">
              {QUESTIONS.flatMap((item, i) =>
                ([true, false] as const).flatMap((yes) => {
                  const amount = yes ? fresh.user.yes[i] : fresh.user.no[i];
                  return amount > 0n
                    ? [
                        <li
                          key={`${i}-${yes}`}
                          className="flex items-center justify-between gap-3 py-3"
                        >
                          <div>
                            <p className="text-xs text-ink-dim">{item.title}</p>
                            <p className="mt-1 font-mono text-sm">
                              {formatCst(amount)} {yes ? "YES" : "NO"}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Transfer ${yes ? "YES" : "NO"}: ${item.title}`}
                            disabled={!!recoveryPending}
                            onClick={() => setTransfer({ question: i as QuestionId, yes })}
                          >
                            Transfer
                          </Button>
                        </li>,
                      ]
                    : [];
                }),
              )}
            </ul>
            {fresh.user.yes.every((amount) => amount === 0n) &&
              fresh.user.no.every((amount) => amount === 0n) && (
                <p className="mt-4 text-sm text-ink-dim">No positions held in this cycle.</p>
              )}
            {transfer && (
              <TransferPositionPanel
                key={`${transfer.question}-${transfer.yes}`}
                roundId={fresh.roundId}
                question={transfer.question}
                yes={transfer.yes}
                available={
                  transfer.yes
                    ? fresh.user.yes[transfer.question]
                    : fresh.user.no[transfer.question]
                }
                market={market}
                sender={sender}
                pending={recoveryPending}
                onTransfer={actions.transfer}
                onCancel={() => setTransfer(null)}
              />
            )}
          </Card>
        </div>
      )}
      {actions.message && (
        <p role="status" className="rounded-xl border border-line p-3 text-sm text-ink-dim">
          {actions.message}
        </p>
      )}
    </section>
  );
}
