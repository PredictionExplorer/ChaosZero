import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FAQ_CATEGORIES } from "@/components/faq/faq-data";
import { SITE_NAME } from "@/lib/site";
import { parseHtml, readJsonLd } from "@/test/html";
import FaqPage, { metadata } from "./page";

const QUESTIONS = FAQ_CATEGORIES.flatMap((category) => category.items);

describe("FAQ page metadata", () => {
  it("is its own canonical page with a descriptive title", () => {
    expect(metadata.title).toBe("FAQ");
    expect(metadata.alternates?.canonical).toBe("/faq");
    expect(metadata.description).toMatch(/Chaos Zero/);
  });

  it("shares with the FAQ title, branded", () => {
    expect(metadata.openGraph).toMatchObject({ url: "/faq", title: `FAQ — ${SITE_NAME}` });
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      title: `FAQ — ${SITE_NAME}`,
    });
  });
});

describe("FAQ page", () => {
  it("marks FAQ as the current page and offers a plain link back to the market", () => {
    render(<FaqPage />);

    expect(screen.getByRole("link", { name: "FAQ" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Open the market" })).toHaveAttribute("href", "/");
  });

  it("ships without the wallet stack", () => {
    render(<FaqPage />);
    expect(screen.queryByRole("button", { name: /connect/i })).not.toBeInTheDocument();
  });

  it("server-renders every question for crawlers that do not run JavaScript", () => {
    const text = parseHtml(renderToString(<FaqPage />)).textContent ?? "";
    for (const item of QUESTIONS) {
      expect(text).toContain(item.question);
    }
  });

  it("publishes the FAQ and its breadcrumb trail as structured data", () => {
    const [faq, breadcrumb] = readJsonLd(parseHtml(renderToString(<FaqPage />)));

    expect(faq).toMatchObject({ "@type": "FAQPage" });
    expect((faq!.mainEntity as unknown[]).length).toBe(QUESTIONS.length);
    expect(breadcrumb).toMatchObject({ "@type": "BreadcrumbList" });
    expect((breadcrumb!.itemListElement as { name: string }[]).map((entry) => entry.name)).toEqual([
      "Home",
      "FAQ",
    ]);
  });
});
