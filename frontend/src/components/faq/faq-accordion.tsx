"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { FaqItem } from "./faq-data";
import { Card } from "@/components/ui/card";

/**
 * One expandable Q&A. The answer is ALWAYS in the DOM — crawlers and AI
 * agents read it straight from the server-rendered HTML — and expanding only
 * reveals it visually, via a pure-CSS grid-rows transition (no animation
 * library on this page). Items are independent: opening one never closes
 * another, so the page reads as a scannable index.
 */
function FaqAccordionItem({ item }: { item: FaqItem }) {
  const [open, setOpen] = useState(false);
  const buttonId = `faq-q-${item.id}`;
  const panelId = `faq-a-${item.id}`;

  return (
    <Card className="overflow-hidden" data-testid={`faq-item-${item.id}`}>
      <h3>
        <button
          id={buttonId}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          data-testid={`faq-question-${item.id}`}
          className="flex w-full items-center justify-between gap-4 p-5 text-left transition-colors hover:bg-surface-2/40"
        >
          <span className="font-display text-sm font-semibold text-ink sm:text-base">
            {item.question}
          </span>
          <ChevronDown
            className={[
              "size-4 shrink-0 text-ink-faint transition-transform duration-200",
              open ? "rotate-180 text-signal-bright" : "",
            ].join(" ")}
            aria-hidden
          />
        </button>
      </h3>
      <div
        className={[
          "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        ].join(" ")}
      >
        <div
          id={panelId}
          role="region"
          aria-labelledby={buttonId}
          aria-hidden={!open}
          data-testid={`faq-answer-${item.id}`}
          className={[
            "min-h-0 overflow-hidden transition-[visibility] duration-200 motion-reduce:transition-none",
            open ? "visible" : "invisible",
          ].join(" ")}
        >
          <div className="space-y-2.5 border-t border-line px-5 pb-5 pt-4">
            {item.answer.map((paragraph) => (
              <p key={paragraph} className="text-sm leading-relaxed text-ink-dim">
                {paragraph}
              </p>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

/** A stack of accordion items for one FAQ category. */
export function FaqAccordion({ items }: { items: readonly FaqItem[] }) {
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <FaqAccordionItem key={item.id} item={item} />
      ))}
    </div>
  );
}
