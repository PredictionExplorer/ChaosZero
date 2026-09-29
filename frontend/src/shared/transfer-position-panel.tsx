"use client";

import { useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { formatUnits, type Address } from "viem";
import { Button } from "@/components/ui/button";
import { formatCst, parseCstInput, shortAddress } from "@/lib/format";
import { validateRecipient } from "./positions";
import { QUESTIONS, type QuestionId } from "./questions";

const fieldClass =
  "h-11 w-full rounded-xl border border-line-strong bg-void/70 px-3 font-mono text-sm text-ink outline-none focus:border-signal focus:ring-1 focus:ring-signal disabled:opacity-50";

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
