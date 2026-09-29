import Link from "next/link";
import { appConfig } from "@/lib/config";
import { AddressLink } from "@/components/ui/address-link";
import { Card } from "@/components/ui/card";
import { FaqAccordion } from "./faq-accordion";
import { FAQ_CATEGORIES } from "./faq-data";

function CategoryLinks({ orientation }: { orientation: "rail" | "chips" }) {
  return (
    <ul
      className={
        orientation === "rail"
          ? "space-y-1"
          : "flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      }
    >
      {FAQ_CATEGORIES.map((category) => (
        <li key={category.id} className={orientation === "chips" ? "shrink-0" : undefined}>
          <a
            href={`#${category.id}`}
            className={[
              "flex items-center gap-2.5 rounded-xl border text-sm transition-colors",
              orientation === "rail"
                ? "border-transparent px-3 py-2 text-ink-dim hover:bg-surface-2/60 hover:text-ink"
                : "border-line bg-surface/60 px-3 py-1.5 text-xs text-ink-dim hover:border-signal/50 hover:text-signal-bright",
            ].join(" ")}
          >
            <category.icon className="size-4 text-signal-bright" aria-hidden />
            <span className="font-medium">{category.title}</span>
            {orientation === "rail" && (
              <span className="ml-auto font-mono text-[11px] text-ink-faint">
                {category.items.length}
              </span>
            )}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** The full FAQ screen: hero, category jump-nav, accordion sections, outro. */
export function FaqContent() {
  return (
    <div data-testid="faq-content">
      {/* Hero */}
      <div className="mx-auto max-w-2xl py-10 text-center sm:py-14">
        <p className="font-mono text-xs uppercase tracking-[0.35em] text-signal-bright">
          Help center
        </p>
        <h1 className="mt-4 font-display text-4xl font-bold tracking-tight sm:text-5xl">
          Frequently asked <span className="text-signal-bright">questions</span>
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-ink-dim sm:text-base">
          Everything about betting on gestures — how prices form, how rounds resolve, what the risks
          are, and why your funds stay yours. All of it enforced by one immutable contract.
        </p>
      </div>

      {/* Mobile category chips */}
      <nav aria-label="FAQ categories" className="mb-8 lg:hidden">
        <CategoryLinks orientation="chips" />
      </nav>

      <div className="grid items-start gap-10 lg:grid-cols-[240px_1fr]">
        {/* Desktop jump-nav rail */}
        <nav aria-label="FAQ categories" className="sticky top-24 hidden self-start lg:block">
          <p className="px-3 pb-2 font-mono text-[11px] uppercase tracking-wider text-ink-faint">
            On this page
          </p>
          <CategoryLinks orientation="rail" />
        </nav>

        {/* Q&A sections */}
        <div className="space-y-14">
          {FAQ_CATEGORIES.map((category) => (
            <section
              key={category.id}
              id={category.id}
              aria-labelledby={`faq-section-${category.id}`}
              className="scroll-mt-24"
              data-testid={`faq-section-${category.id}`}
            >
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-xl bg-signal/12 text-signal-bright">
                  <category.icon className="size-4.5" aria-hidden />
                </span>
                <div>
                  <h2
                    id={`faq-section-${category.id}`}
                    className="font-display text-xl font-semibold"
                  >
                    {category.title}
                  </h2>
                  <p className="text-xs text-ink-faint">{category.description}</p>
                </div>
              </div>
              <div className="mt-4">
                <FaqAccordion items={category.items} />
              </div>
            </section>
          ))}

          {/* Outro */}
          <Card accent="signal" className="p-8 text-center" data-testid="faq-outro">
            <h2 className="font-display text-xl font-semibold">Still curious?</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-dim">
              The market is a single open contract — read it, verify it, or head back and watch the
              odds move live.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
              <Link
                href="/"
                className="inline-flex h-10 items-center justify-center rounded-xl bg-signal px-5 text-sm font-semibold text-void shadow-glow-signal transition-all hover:bg-signal-bright"
              >
                Go to the market
              </Link>
              <a
                href="https://cosmicsignature.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-ink-dim transition-colors hover:text-signal-bright"
              >
                Play Cosmic Signature ↗
              </a>
              {appConfig.marketAddress && (
                <span className="text-sm text-ink-dim">
                  Contract <AddressLink address={appConfig.marketAddress} />
                </span>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
