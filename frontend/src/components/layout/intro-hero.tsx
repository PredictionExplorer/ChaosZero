import { ArrowDown, Check, Coins, Trophy } from "lucide-react";
import { COSMIC_SIGNATURE_URL } from "@/lib/site";

const STEPS = [
  { icon: Check, label: "Pick YES or NO" },
  { icon: Coins, label: "Stake CST" },
  { icon: Trophy, label: "Winning tokens pay 1 CST each" },
] as const;

/**
 * The first thing a visitor (or crawler) sees: what this site is, in one
 * compact band. Server-rendered static HTML — it must never wait for the
 * wallet/market JavaScript to explain itself.
 */
export function IntroHero() {
  return (
    <section aria-labelledby="intro-hero-title" data-testid="intro-hero" className="mb-8">
      <div className="relative overflow-hidden rounded-2xl border border-line bg-surface/50 p-6 sm:p-7">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(36rem_16rem_at_-4%_-40%,rgba(139,123,255,0.14),transparent_60%),radial-gradient(30rem_14rem_at_104%_140%,rgba(52,227,165,0.08),transparent_60%)]"
        />
        <div className="relative grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-signal-bright">
              Chaos Zero · Prediction market · Arbitrum One
            </p>
            <h1
              id="intro-hero-title"
              className="mt-2 font-display text-2xl font-bold tracking-tight sm:text-3xl"
            >
              Bet on <span className="text-signal-bright">Cosmic Signature</span> gestures
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-dim">
              Every round of{" "}
              <a
                href={COSMIC_SIGNATURE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-signal-bright underline decoration-signal/40 underline-offset-2 transition-colors hover:text-ink"
              >
                Cosmic Signature
              </a>{" "}
              — an on-chain NFT game where every bid is a &ldquo;gesture&rdquo; — ends with a final
              gesture count. This market asks one question, every round:{" "}
              <strong className="font-semibold text-ink">
                will this round end with more gestures than the last one?
              </strong>
            </p>
            <p className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-ink-faint">
              <a
                href="#how-it-works"
                className="flex items-center gap-1 font-medium text-ink-dim transition-colors hover:text-signal-bright"
              >
                How it works
                <ArrowDown className="size-3" aria-hidden />
              </a>
              <a
                href={COSMIC_SIGNATURE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-ink-dim transition-colors hover:text-signal-bright"
              >
                New to the game? Play Cosmic Signature ↗
              </a>
            </p>
          </div>

          <ol
            className="flex shrink-0 flex-row flex-wrap gap-2 lg:flex-col"
            aria-label="How betting works, in three steps"
          >
            {STEPS.map((step, i) => (
              <li
                key={step.label}
                className="flex items-center gap-2.5 rounded-xl border border-line bg-void/40 px-3.5 py-2"
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-signal/15 font-mono text-[11px] font-semibold text-signal-bright">
                  {i + 1}
                </span>
                <span className="flex items-center gap-1.5 text-xs font-medium text-ink-dim">
                  <step.icon className="size-3.5 text-signal-bright" aria-hidden />
                  {step.label}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
