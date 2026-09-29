import Link from "next/link";
import type { ReactNode } from "react";
import { COSMIC_SIGNATURE_URL } from "@/lib/site";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { BrandMark } from "./brand-mark";

const NAV_LINKS = [
  { id: "market", href: "/", label: "Market" },
  { id: "faq", href: "/faq", label: "FAQ" },
] as const;

export type NavPage = (typeof NAV_LINKS)[number]["id"];

interface HeaderProps {
  /** Which nav entry the current page is (drives aria-current + highlight). */
  active: NavPage;
  /**
   * Right-side slot: the wallet button on the market page, a plain CTA on
   * static pages. Keeping this a slot lets static pages ship without any
   * wallet JavaScript.
   */
  actions?: ReactNode;
}

/** Server-rendered site header; each page declares its own active tab and actions. */
export function Header({ active, actions }: HeaderProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-void/70 backdrop-blur-lg">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3 sm:gap-6">
          <div className="flex items-center gap-2.5">
            <Link href="/" className="group flex items-center gap-2.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-signal/15 text-signal-bright transition-shadow group-hover:shadow-glow-signal">
                <BrandMark className="size-5" />
              </span>
              {/* Visually hidden (not display:none) below md, so the icon-only
                  home link keeps its accessible name on phones. */}
              <span className="sr-only font-display text-lg font-bold tracking-tight md:not-sr-only">
                Chaos<span className="text-signal-bright">Zero</span>
              </span>
            </Link>
            <Tooltip
              side="bottom"
              align="start"
              content="Early software on a live chain: the contract is immutable and tested, but young. Size your bets accordingly."
            >
              <Badge tone="signal" pulse className="cursor-help" data-testid="beta-badge">
                Beta
              </Badge>
            </Tooltip>
          </div>
          <nav aria-label="Primary" className="flex items-center gap-1">
            {NAV_LINKS.map((link) => {
              const isActive = link.id === active;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={isActive ? "page" : undefined}
                  className={[
                    "rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors sm:px-3",
                    isActive
                      ? "bg-signal/15 text-signal-bright"
                      : "text-ink-dim hover:bg-surface-2 hover:text-ink",
                  ].join(" ")}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <a
            href={COSMIC_SIGNATURE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden text-xs text-ink-faint transition-colors hover:text-signal-bright lg:block"
          >
            Play Cosmic Signature ↗
          </a>
          {actions}
        </div>
      </div>
    </header>
  );
}
