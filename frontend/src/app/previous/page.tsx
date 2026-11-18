import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { Providers } from "@/app/providers";
import { ConnectButton } from "@/components/wallet/connect-button";
import { IndependentGate } from "@/independent/app";
import { previousMarketAddress } from "@/independent/config";

export const metadata: Metadata = { title: "Previous eight-question market" };

export default function PreviousMarketPage() {
  return (
    <Providers>
      <main className="mx-auto max-w-7xl space-y-6 p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/">Current market</Link>
          <ConnectButton />
        </header>
        <h1 className="font-display text-3xl font-semibold">Previous eight-question market</h1>
        <p>
          Positions from this contract stay here. Select their cycle to merge pairs or retrieve
          claims.
        </p>
        {previousMarketAddress && (
          <p className="break-all font-mono text-sm">{previousMarketAddress}</p>
        )}
        <form action="/previous" className="flex flex-wrap items-center gap-3">
          <label htmlFor="previous-cycle">Cycle number</label>
          <input
            id="previous-cycle"
            name="round"
            inputMode="numeric"
            pattern="[0-9]+"
            required
            className="rounded border border-line px-2"
          />
          <button className="rounded border border-line px-3 py-1">View cycle</button>
        </form>
        <Suspense fallback={<p role="status">Reading previous market…</p>}>
          <IndependentGate previous />
        </Suspense>
      </main>
    </Providers>
  );
}
