import { describe, expect, it, vi } from "vitest";
import { FAQ_CATEGORIES } from "@/components/faq/faq-data";
import { COSMIC_CST_ADDRESS, COSMIC_GAME_ADDRESS } from "@/lib/config";
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
    expect(text).toMatch(/zero oracles, zero admin keys, zero custody/i);
  });

  it("links every page with self-consistent absolute URLs", async () => {
    const text = await getLlms().text();
    expect(text).toContain(`](${SITE_URL})`);
    expect(text).toContain(`](${absoluteUrl("/faq")})`);
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

describe("deployment facts in both documents", () => {
  const MARKET = "0xDe5bC71e94B991265B2DfDCE0921245B70c51b4d";

  /** Loads both routes fresh, so the config singleton sees the current env. */
  async function loadRoutes() {
    vi.resetModules();
    const [short, full] = await Promise.all([import("./llms.txt/route"), import("./llms-full.txt/route")]);
    return [await short.GET().text(), await full.GET().text()];
  }

  it("state the chain, the game proxy and the CST token of Arbitrum One", async () => {
    vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "42161");
    for (const text of await loadRoutes()) {
      expect(text).toContain("Chain: Arbitrum One (chain id 42161).");
      expect(text).toContain(`Cosmic Signature game proxy: ${COSMIC_GAME_ADDRESS}.`);
      expect(text).toContain(`CST token: ${COSMIC_CST_ADDRESS}.`);
    }
  });

  it("name the market contract once one is deployed", async () => {
    vi.stubEnv("NEXT_PUBLIC_MARKET_ADDRESS", MARKET);
    for (const text of await loadRoutes()) {
      expect(text).toContain(`Market contract: ${MARKET}.`);
    }
  });

  it("never invent a market contract when none is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_MARKET_ADDRESS", "");
    for (const text of await loadRoutes()) {
      expect(text).not.toContain("Market contract:");
    }
  });
});
