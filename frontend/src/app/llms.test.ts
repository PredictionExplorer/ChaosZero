import { describe, expect, it } from "vitest";
import { FAQ_CATEGORIES } from "@/components/faq/faq-data";
import { COSMIC_SIGNATURE_URL, SITE_URL, absoluteUrl } from "@/lib/site";
import { GET as getLlms, dynamic as llmsDynamic } from "./llms.txt/route";
import { GET as getLlmsFull, dynamic as llmsFullDynamic } from "./llms-full.txt/route";

describe("llms.txt", () => {
  it("is rendered at build time, like the sitemap", () => {
    expect(llmsDynamic).toBe("force-static");
  });

  it("serves plain text that explains the market to AI crawlers", async () => {
    const response = getLlms();
    expect(response.headers.get("content-type")).toContain("text/plain");

    const text = await response.text();
    expect(text).toMatch(/^# Chaos Zero/);
    expect(text).toMatch(/cosmic signature/i);
    expect(text).toMatch(/gestures? \(bids\)/i);
    expect(text).toMatch(/YES/);
    expect(text).toMatch(/eight YES\/NO prediction markets/i);
    expect(text).toMatch(/50% YES and 50% NO/);
    expect(text).toMatch(/contributions are irreversible/i);
    expect(text).not.toMatch(/zero custody|fee voting|tradable before they start|resolved early/i);
  });

  it("links every page with self-consistent absolute URLs", async () => {
    const text = await getLlms().text();
    expect(text).toContain(`](${SITE_URL})`);
    expect(text).toContain(`](${absoluteUrl("/faq")})`);
    expect(text).toContain(`](${absoluteUrl("/baseline")})`);
    expect(text).toContain(`](${absoluteUrl("/baseline.json")})`);
    expect(text).toContain(`](${absoluteUrl("/llms-full.txt")})`);
    expect(text).toContain(COSMIC_SIGNATURE_URL);
  });
});

describe("llms-full.txt", () => {
  it("is rendered at build time, like the sitemap", () => {
    expect(llmsFullDynamic).toBe("force-static");
  });

  it("contains the entire FAQ verbatim — every question and every answer paragraph", async () => {
    const response = getLlmsFull();
    expect(response.headers.get("content-type")).toContain("text/plain");

    const text = await response.text();
    expect(text).toMatch(/^# Chaos Zero — full knowledge base/);

    for (const category of FAQ_CATEGORIES) {
      expect(text).toContain(`## ${category.title}`);
      for (const item of category.items) {
        expect(text).toContain(`### ${item.question}`);
        for (const paragraph of item.answer) {
          expect(text).toContain(paragraph);
        }
      }
    }
  });

  it("points back at the short index", async () => {
    const text = await getLlmsFull().text();
    expect(text).toContain(absoluteUrl("/llms.txt"));
  });
});
