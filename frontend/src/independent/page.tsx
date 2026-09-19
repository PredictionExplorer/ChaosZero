import { Suspense } from "react";
import Link from "next/link";
import { Layers3 } from "lucide-react";
import { Providers } from "@/app/providers";
import { BrandMark } from "@/components/layout/brand-mark";
import { ConnectButton } from "@/components/wallet/connect-button";
import { IndependentGate } from "./app";

export function IndependentPage() {
  return (
    <Providers>
      <header className="border-b border-line bg-void/75 backdrop-blur-lg">
        <div className="mx-auto flex min-h-18 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/shared" className="flex items-center gap-3 font-display text-lg font-bold">
            <span className="rounded-xl bg-signal/15 p-2 text-signal-bright">
              <BrandMark className="size-6" />
            </span>
            <span>
              Chaos<span className="text-signal-bright">Zero</span>
            </span>
          </Link>
          <ConnectButton />
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <section className="mb-10 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-signal-bright">
              <Layers3 className="size-4" aria-hidden /> Independent markets · local prototype
            </p>
            <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">
              Eight questions.
              <br />
              <span className="text-ink-dim">Eight independent pools.</span>
            </h1>
          </div>
          <p className="max-w-sm text-sm leading-6 text-ink-dim">
            Fund once, trade each question independently. Winning claims stay protected while every
            remaining CST moves to the next cycle.
          </p>
        </section>
        <Suspense
          fallback={
            <p role="status" className="text-ink-dim">
              Connecting to the independent market…
            </p>
          }
        >
          <IndependentGate />
        </Suspense>
      </main>
      <footer className="mt-12 border-t border-line">
        <div className="mx-auto max-w-7xl px-4 py-7 text-xs leading-5 text-ink-dim sm:px-6">
          <p className="max-w-3xl">
            This prototype uses local test CST and an on-chain game simulator. Sponsorship is an
            irreversible gift with no LP shares or withdrawal rights. Each winning position pays 1
            CST; unused funding rolls forward and is not a bonus payout.
          </p>
        </div>
      </footer>
    </Providers>
  );
}
