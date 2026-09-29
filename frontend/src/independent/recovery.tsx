"use client";

import { useState } from "react";
import type { Address } from "viem";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConnectButton } from "@/components/wallet/connect-button";
import { formatCst } from "@/lib/format";
import { TransferPositionPanel } from "@/shared/transfer-position-panel";
import { MAX_ROUND_ID } from "@/shared/positions";
import { QUESTIONS, type QuestionId } from "@/shared/questions";
import { IndependentSetsPanel, fieldClass } from "./components";
import { winningClaims, type IndependentActions, type IndependentRecovery } from "./models";

export function IndependentRecoveryPanel({
  market,
  owner,
  roundId,
  onRound,
  query,
  actions,
  connected,
}: {
  market: Address;
  owner: Address | undefined;
  roundId: bigint | null;
  onRound: (round: bigint) => void;
  query: {
    data?: IndependentRecovery;
    error: Error | null;
    isFetching: boolean;
    refetch: () => Promise<unknown>;
  };
  actions: IndependentActions;
  connected: boolean;
}) {
  const [roundInput, setRoundInput] = useState(roundId?.toString() ?? "");
  const [transfer, setTransfer] = useState<{ question: QuestionId; yes: boolean } | null>(null);
  const parsed = /^\d{1,76}$/.test(roundInput) ? BigInt(roundInput) : null;
  const valid = parsed !== null && parsed <= MAX_ROUND_ID;
  const current =
    query.data &&
    !query.error &&
    query.data.roundId === roundId &&
    query.data.market.toLowerCase() === market.toLowerCase() &&
    query.data.user.owner.toLowerCase() === owner?.toLowerCase()
      ? query.data
      : null;
  const blocked = {
    ...actions,
    pending: actions.pending ?? (query.isFetching ? "Refreshing owned positions" : null),
  };
  const held = current
    ? current.user.yes.some((amount, i) => amount > 0n || current.user.no[i] > 0n)
    : false;
  return (
    <section className="mt-5 space-y-4" data-testid="independent-recovery">
      <Card accent="ended" className="p-5">
        <h2 className="font-display text-lg font-semibold">Recover owned positions</h2>
        <p className="mt-2 text-sm leading-6 text-ink-dim">
          Outcome data is unavailable. Fresh market balances still allow pair merges and transfers.
          Already-settled winnings remain retrievable from their separate reserve.
        </p>
        <label
          htmlFor="independent-recovery-round"
          className="mb-2 mt-4 block text-xs text-ink-dim"
        >
          Explicit cycle number
        </label>
        <div className="flex gap-2">
          <input
            id="independent-recovery-round"
            inputMode="numeric"
            value={roundInput}
            onChange={(event) => setRoundInput(event.target.value)}
            className={fieldClass}
            disabled={!!blocked.pending}
          />
          <Button
            variant="outline"
            disabled={!valid || !!blocked.pending}
            onClick={() => {
              if (valid && parsed !== null) {
                onRound(parsed);
                if (parsed === roundId) void query.refetch();
              }
            }}
          >
            Load positions
          </Button>
        </div>
        {roundInput && !valid && (
          <p role="alert" className="mt-2 text-xs text-lower">
            Enter a supported non-negative cycle number.
          </p>
        )}
        {!connected && (
          <div className="mt-3">
            <ConnectButton />
          </div>
        )}
        {roundId === null && (
          <p className="mt-3 text-xs text-ink-dim">
            Choose a cycle; the current cycle cannot be guessed while the source is unavailable.
          </p>
        )}
        {query.isFetching && (
          <p role="status" className="mt-3 text-xs text-ink-dim">
            Refreshing owned positions…
          </p>
        )}
        {query.error && (
          <p role="alert" className="mt-3 text-sm text-lower">
            Fresh balances are unavailable. No recovery transaction can be submitted.{" "}
            {query.error.message}
          </p>
        )}
      </Card>
      {current && connected && (
        <div className="grid gap-4 lg:grid-cols-2">
          <IndependentSetsPanel
            roundId={current.roundId}
            user={current.user}
            collaterals={current.questions.map((q) => q.pool.collateral)}
            open={false}
            finalized={current.settled}
            connected
            actions={blocked}
            recovery
          />
          <Card className="p-5">
            <h3 className="break-words font-display text-lg font-semibold">
              Owned positions · cycle {current.roundId.toString()}
            </h3>
            <ul className="mt-4 divide-y divide-line">
              {QUESTIONS.flatMap((item, q) =>
                [true, false].flatMap((yes) => {
                  const amount = yes ? current.user.yes[q] : current.user.no[q];
                  return amount > 0n
                    ? [
                        <li key={`${q}-${yes}`} className="flex justify-between gap-3 py-3">
                          <div>
                            <p className="text-xs text-ink-dim">{item.title}</p>
                            <p className="font-mono text-sm">
                              {formatCst(amount)} {yes ? "YES" : "NO"}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Transfer ${yes ? "YES" : "NO"}: ${item.title}`}
                            disabled={!!blocked.pending}
                            onClick={() => setTransfer({ question: q as QuestionId, yes })}
                          >
                            Transfer
                          </Button>
                        </li>,
                      ]
                    : [];
                }),
              )}
            </ul>
            {!held && <p className="mt-3 text-sm text-ink-dim">No positions held in this cycle.</p>}
            {transfer && (
              <TransferPositionPanel
                key={`${transfer.question}-${transfer.yes}`}
                roundId={current.roundId}
                question={transfer.question}
                yes={transfer.yes}
                available={
                  transfer.yes
                    ? current.user.yes[transfer.question]
                    : current.user.no[transfer.question]
                }
                market={market}
                sender={owner}
                pending={blocked.pending}
                onTransfer={actions.transfer}
                onCancel={() => setTransfer(null)}
              />
            )}
            {current.settled ? (
              <div className="mt-5 border-t border-line pt-4">
                <p className="mb-3 text-xs text-ink-dim">
                  Reserved winnings:{" "}
                  <span className="font-mono text-higher" data-testid="recovery-claimable">
                    {formatCst(winningClaims(current.user, true, current.values))} CST
                  </span>
                </p>
                <Button
                  variant="outline"
                  disabled={!held || !!blocked.pending}
                  onClick={() => void actions.claim()}
                >
                  Retrieve settled winnings
                </Button>
              </div>
            ) : (
              <p className="mt-4 text-xs leading-5 text-ink-dim">
                Claims need recorded settlement before they can be retrieved without outcome data.
              </p>
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
