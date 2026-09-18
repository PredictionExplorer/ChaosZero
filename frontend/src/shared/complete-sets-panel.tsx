"use client";

import { useState } from "react";
import { ArrowLeftRight, Layers3 } from "lucide-react";
import { formatUnits, type Address } from "viem";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConnectButton } from "@/components/wallet/connect-button";
import { formatCst, parseCstInput, shortAddress } from "@/lib/format";
import { MAX_COLLATERAL } from "./math";
import { matchedSets, validateRecipient, type PositionAmounts } from "./positions";
import { QUESTIONS, questionKnown, type QuestionId } from "./questions";
import type { SharedSnapshot } from "./use-shared-market";

const fieldClass =
  "h-11 w-full rounded-xl border border-line-strong bg-void/70 px-3 font-mono text-sm text-ink outline-none focus:border-signal focus:ring-1 focus:ring-signal disabled:opacity-50";

export interface CompleteSetsPanelProps {
  roundId: bigint;
  user: SharedSnapshot["user"];
  collateral: bigint;
  open: boolean;
  knownMask: number | null;
  connected: boolean;
  pending: string | null;
  mergeOnly?: boolean;
  onApprove: (amount: bigint) => Promise<boolean>;
  onSplit: (question: QuestionId, amount: bigint) => Promise<boolean>;
  onMerge: (question: QuestionId, amount: bigint) => Promise<boolean>;
  onMergeAll: (amounts: PositionAmounts) => Promise<boolean>;
}

export function CompleteSetsPanel({
  roundId,
  user,
  collateral,
  open,
  knownMask,
  connected,
  pending,
  mergeOnly = false,
  onApprove,
  onSplit,
  onMerge,
  onMergeAll,
}: CompleteSetsPanelProps) {
  const [split, setSplit] = useState(!mergeOnly);
  const [question, setQuestion] = useState<QuestionId>(0);
  const [input, setInput] = useState("");
  const pairs = user ? matchedSets(user.yes, user.no) : Array<bigint>(8).fill(0n);
  const matched = pairs[question];
  const allMatched = pairs.reduce((sum, amount) => sum + amount, 0n);
  const parsed = parseCstInput(input);
  const amount = parsed.value ?? 0n;
  const splitAllowed =
    !mergeOnly && open && knownMask !== null && !questionKnown(knownMask, question);
  const approval = split && amount > (user?.allowance ?? 0n);
  const error =
    parsed.error ??
    (split && user && amount > user.balance
      ? "Not enough CST to split."
      : !split && amount > matched
        ? "Not enough matched YES and NO units for this question."
        : split && collateral + amount > MAX_COLLATERAL
          ? "This split exceeds the cycle’s collateral limit."
          : null);
  const ready = amount > 0n && !error && (split ? splitAllowed : true);
  return (
    <Card className="p-5" accent="signal" data-testid="complete-sets-panel">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
        <Layers3 className="size-4 text-signal" aria-hidden /> Complete sets
      </h2>
      <p className="mt-2 text-xs leading-5 text-ink-dim">
        1 CST ↔ 1 YES + 1 NO for the same question and cycle. No AMM trade or price slippage.
      </p>
      {!mergeOnly && (
        <div
          className="my-4 grid grid-cols-2 gap-1 rounded-xl bg-void/70 p-1"
          aria-label="Complete-set action"
        >
          {[true, false].map((mode) => (
            <button
              key={String(mode)}
              aria-pressed={split === mode}
              disabled={!!pending}
              onClick={() => {
                setSplit(mode);
                setInput("");
              }}
              className={`rounded-lg py-2 text-sm font-medium ${split === mode ? "bg-surface-2 text-ink" : "text-ink-dim"}`}
            >
              {mode ? "Split CST" : "Merge pairs"}
            </button>
          ))}
        </div>
      )}
      {mergeOnly && (
        <p className="mt-3 text-xs leading-5 text-ended">
          Outcome data is unavailable. Fresh balances below support merges without a settlement
          decision.
        </p>
      )}
      <label htmlFor="complete-set-question" className="mb-2 mt-4 block text-xs text-ink-dim">
        Question · cycle {roundId.toString()}
      </label>
      <select
        id="complete-set-question"
        value={question}
        onChange={(event) => {
          setQuestion(Number(event.target.value) as QuestionId);
          setInput("");
        }}
        className={fieldClass}
        disabled={!!pending}
      >
        {QUESTIONS.map((item, index) => (
          <option key={item.title} value={index}>
            {index + 1}. {item.title}
          </option>
        ))}
      </select>
      <div className="my-3 flex items-center justify-between text-xs">
        <span className="text-ink-dim">Matched pairs for this question</span>
        <span className="font-mono" data-testid="selected-matched-pairs">
          {formatCst(matched)}
        </span>
      </div>
      <div className="mb-2 flex items-center justify-between text-xs text-ink-dim">
        <label htmlFor="complete-set-amount">{split ? "CST to split" : "Pairs to merge"}</label>
        {!split && matched > 0n && (
          <button
            onClick={() => setInput(formatUnits(matched, 18))}
            className="text-signal-bright"
            disabled={!!pending}
          >
            Use maximum
          </button>
        )}
      </div>
      <input
        id="complete-set-amount"
        inputMode="decimal"
        value={input}
        onChange={(event) => setInput(event.target.value)}
        placeholder="0.00"
        className={fieldClass}
        disabled={!!pending}
        aria-invalid={!!error}
        aria-describedby="complete-set-feedback"
      />
      <p
        id="complete-set-feedback"
        role={error ? "alert" : undefined}
        className="mt-2 min-h-4 text-xs text-lower"
      >
        {error}
      </p>
      <p className="my-3 text-sm text-ink-dim" data-testid="complete-set-output">
        {amount > 0n
          ? split
            ? `Receive ${formatUnits(amount, 18)} YES + ${formatUnits(amount, 18)} NO.`
            : `Receive exactly ${formatUnits(amount, 18)} CST.`
          : "Enter an amount to see the exact conversion."}
      </p>
      {split && !splitAllowed && (
        <p className="mb-3 text-xs text-ended">
          Splitting is available only while this question is open and unresolved. Merging remains
          available.
        </p>
      )}
      {!connected ? (
        <div className="flex justify-center">
          <ConnectButton />
        </div>
      ) : (
        <Button
          className="w-full"
          variant="outline"
          disabled={!ready || !!pending}
          loading={pending === "Complete-set split" || pending === "Complete-set merge"}
          onClick={async () => {
            if (!ready) return;
            if (approval) await onApprove(amount);
            else if (await (split ? onSplit(question, amount) : onMerge(question, amount)))
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
        <div className="mb-3 flex justify-between text-xs">
          <span className="text-ink-dim">Matched across all eight questions</span>
          <span className="font-mono" data-testid="all-matched-pairs">
            {formatCst(allMatched)} CST
          </span>
        </div>
        {allMatched > 0n && (
          <ul className="mb-3 space-y-1 text-[11px] text-ink-dim">
            {pairs.map((count, index) =>
              count > 0n ? (
                <li key={index} className="flex justify-between">
                  <span>{QUESTIONS[index].title}</span>
                  <span className="font-mono">{formatCst(count)} pairs</span>
                </li>
              ) : null,
            )}
          </ul>
        )}
        {allMatched > 0n && (
          <p className="mb-3 text-xs leading-5 text-ink-dim" data-testid="batch-merge-exact">
            Merge all returns exactly {formatUnits(allMatched, 18)} CST.
          </p>
        )}
        <Button
          variant="ghost"
          className="w-full"
          disabled={!connected || allMatched === 0n || !!pending}
          loading={pending === "Matched-set merge"}
          onClick={() => user && void onMergeAll(matchedSets(user.yes, user.no))}
        >
          Merge all matched pairs
        </Button>
      </div>
      <p className="mt-3 text-[11px] leading-5 text-ink-faint">
        Matching never crosses questions or cycles. Splits and merges leave the AMM’s remaining
        reserves and prices unchanged; they do not fund it.
      </p>
    </Card>
  );
}

export function TransferPositionPanel({
  roundId,
  question,
  yes,
  available,
  market,
  sender,
  pending,
  onTransfer,
  onCancel,
}: {
  roundId: bigint;
  question: QuestionId;
  yes: boolean;
  available: bigint;
  market: Address;
  sender: Address | undefined;
  pending: string | null;
  onTransfer: (
    question: QuestionId,
    yes: boolean,
    amount: bigint,
    recipient: string,
  ) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [recipient, setRecipient] = useState("");
  const [input, setInput] = useState("");
  const target = validateRecipient(recipient, sender, market);
  const parsed = parseCstInput(input);
  const amount = parsed.value ?? 0n;
  const error =
    target.error ??
    parsed.error ??
    (amount > available ? "Not enough position units to transfer." : null);
  const valid = !!sender && !!target.address && amount > 0n && !error;
  return (
    <section
      className="mt-4 rounded-xl border border-signal/30 bg-void/50 p-4"
      aria-label="Transfer positions"
      data-testid="transfer-position-panel"
    >
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <ArrowLeftRight className="size-4 text-signal" aria-hidden /> Transfer {yes ? "YES" : "NO"}
      </h3>
      <p className="mt-2 text-xs text-ink-dim">
        Cycle {roundId.toString()} · {QUESTIONS[question].title}
      </p>
      <p className="mt-1 text-xs text-ink-dim">Available: {formatCst(available)} units</p>
      <label htmlFor="position-recipient" className="mb-2 mt-4 block text-xs text-ink-dim">
        Recipient address
      </label>
      <input
        id="position-recipient"
        value={recipient}
        onChange={(event) => setRecipient(event.target.value)}
        autoComplete="off"
        spellCheck={false}
        placeholder="0x…"
        className={fieldClass}
        disabled={!!pending}
        aria-invalid={!!target.error}
      />
      <div className="mb-2 mt-3 flex justify-between text-xs text-ink-dim">
        <label htmlFor="position-transfer-amount">Position units to transfer</label>
        <button
          className="text-signal-bright"
          onClick={() => setInput(formatUnits(available, 18))}
          disabled={!!pending}
        >
          Use maximum
        </button>
      </div>
      <input
        id="position-transfer-amount"
        inputMode="decimal"
        value={input}
        onChange={(event) => setInput(event.target.value)}
        placeholder="0.00"
        className={fieldClass}
        disabled={!!pending}
        aria-invalid={!!error}
      />
      <p className="mt-2 min-h-4 text-xs text-lower" role={error ? "alert" : undefined}>
        {error}
      </p>
      {target.address && amount > 0n && (
        <p className="my-2 text-xs leading-5 text-ink-dim">
          Send {formatUnits(amount, 18)} {yes ? "YES" : "NO"} units to{" "}
          {shortAddress(target.address)}. The recipient controls their sale, merge, or retrieval.
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <Button
          className="flex-1"
          variant="outline"
          disabled={!valid || !!pending}
          loading={pending === "Position transfer"}
          onClick={async () => {
            if (valid && (await onTransfer(question, yes, amount, target.address!))) onCancel();
          }}
        >
          Transfer positions
        </Button>
        <Button variant="ghost" disabled={!!pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <p className="mt-3 text-[11px] leading-5 text-ink-faint">
        Receiving contracts must accept ERC-1155 tokens. No operator approval is requested for this
        direct owner transfer.
      </p>
    </section>
  );
}
