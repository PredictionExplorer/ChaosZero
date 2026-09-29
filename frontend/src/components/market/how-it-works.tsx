import { ArrowRight, Award, Droplets, Repeat, Telescope, Timer } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";

const STEPS = [
  {
    icon: Repeat,
    title: "One question, every round",
    body: "Will this Cosmic Signature round end with more gestures (bids) than the previous one? YES pays 1 CST per token if it does, NO pays 1 CST if it doesn't (a tie counts as NO). A new market opens itself every round.",
  },
  {
    icon: Telescope,
    title: "Bet ahead on future rounds",
    body: "Any future round is open for early positions — fund it, bet it, exit it. Its threshold (last round's final count) locks the moment its round arrives; until then the bar is still forming, in public.",
  },
  {
    icon: Droplets,
    title: "The fee is an LP vote",
    body: "One pool per round. Every LP declares the fee they want; bettors pay the share-weighted average, and fee earnings split pro rata by shares. Re-vote or withdraw any time.",
  },
  {
    icon: Timer,
    title: "No betting on known outcomes",
    body: "The gesture count is public and only goes up. The instant it crosses last round's count, YES is certain: betting halts in the same block and anyone can resolve early. Once a round is over it's withdraw-only, forever.",
  },
  {
    icon: Award,
    title: "Fully backed, no keys",
    body: "1 CST always mints 1 YES + 1 NO, and a pair always redeems for 1 CST, so every payout is collateralized by construction. No owner, no admin keys, no upgrades.",
  },
] as const;

/** A plain-language explainer of the market mechanism. */
export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-it-works-title"
      data-testid="how-it-works"
      className="scroll-mt-24"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="how-it-works-title" className="font-display text-lg font-semibold">
          How it works
        </h2>
        <Link
          href="/faq"
          className="flex items-center gap-1 text-xs font-medium text-signal-bright transition-colors hover:text-ink"
          data-testid="how-it-works-faq-link"
        >
          Read the full FAQ
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {STEPS.map((step, i) => (
          <Card key={step.title} className="p-5">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-lg bg-signal/12 text-signal-bright">
                <step.icon className="size-4" aria-hidden />
              </span>
              <span className="font-mono text-xs text-ink-faint">0{i + 1}</span>
            </div>
            <h3 className="mt-3 font-display text-sm font-semibold text-ink">{step.title}</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-dim">{step.body}</p>
          </Card>
        ))}
      </div>
    </section>
  );
}
