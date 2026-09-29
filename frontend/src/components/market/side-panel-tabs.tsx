"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type SidePanelTab = "bet" | "liquidity";

export interface SidePanelTabsProps {
  /** Marks the Liquidity tab when the user has shares or unclaimed fees. */
  lpIndicator: boolean;
  bet: ReactNode;
  liquidity: ReactNode;
}

const TABS: readonly { id: SidePanelTab; label: string }[] = [
  { id: "bet", label: "Place bet" },
  { id: "liquidity", label: "Liquidity" },
];

/**
 * The sidebar's primary switch between betting (the default focus of the app,
 * always the opening tab) and liquidity provision (tucked away for the LP
 * minority). A WAI-ARIA tabs widget: roving tabindex, arrow-key navigation,
 * panels stay mounted so half-typed amounts survive a tab flip.
 */
export function SidePanelTabs({ lpIndicator, bet, liquidity }: SidePanelTabsProps) {
  const [active, setActive] = useState<SidePanelTab>("bet");
  const tabRefs = useRef(new Map<SidePanelTab, HTMLButtonElement>());

  const select = (tab: SidePanelTab) => {
    setActive(tab);
    tabRefs.current.get(tab)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const order = TABS.map((t) => t.id);
    const i = order.indexOf(active);
    let next: SidePanelTab | undefined;
    if (e.key === "ArrowRight") next = order[(i + 1) % order.length];
    else if (e.key === "ArrowLeft") next = order[(i - 1 + order.length) % order.length];
    else if (e.key === "Home") next = order[0];
    else if (e.key === "End") next = order[order.length - 1];
    if (next !== undefined) {
      e.preventDefault();
      select(next);
    }
  };

  return (
    <div className="space-y-3" data-testid="side-panel-tabs">
      <div
        role="tablist"
        aria-label="Trade actions"
        onKeyDown={onKeyDown}
        className="flex rounded-xl border border-line bg-surface/70 p-1 backdrop-blur-md"
      >
        {TABS.map((tab) => {
          const selected = active === tab.id;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                if (el) tabRefs.current.set(tab.id, el);
                else tabRefs.current.delete(tab.id);
              }}
              role="tab"
              id={`side-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`side-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              data-testid={`side-tab-${tab.id}`}
              onClick={() => select(tab.id)}
              className={[
                "flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 font-display text-sm font-semibold transition-colors",
                selected ? "bg-signal/15 text-signal-bright" : "text-ink-faint hover:text-ink",
              ].join(" ")}
            >
              {tab.label}
              {tab.id === "liquidity" && lpIndicator && (
                <span className="relative flex size-1.5" data-testid="lp-tab-indicator">
                  <span
                    className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal-bright opacity-60"
                    aria-hidden
                  />
                  <span
                    className="relative inline-flex size-1.5 rounded-full bg-signal-bright"
                    aria-hidden
                  />
                  <span className="sr-only">(you have a liquidity position)</span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      {TABS.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`side-panel-${tab.id}`}
          aria-labelledby={`side-tab-${tab.id}`}
          hidden={active !== tab.id}
          data-testid={`side-panel-${tab.id}`}
        >
          {tab.id === "bet" ? bet : liquidity}
        </div>
      ))}
    </div>
  );
}
