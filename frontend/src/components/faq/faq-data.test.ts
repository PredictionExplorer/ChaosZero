import { describe, expect, it } from "vitest";
import { FAQ_CATEGORIES } from "./faq-data";

const allItems = FAQ_CATEGORIES.flatMap((c) => c.items);

describe("FAQ data", () => {
  it("is comprehensive: several categories, 25+ questions", () => {
    expect(FAQ_CATEGORIES.length).toBeGreaterThanOrEqual(5);
    expect(allItems.length).toBeGreaterThanOrEqual(25);
    for (const category of FAQ_CATEGORIES) {
      expect(category.items.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("uses globally unique, anchor-safe kebab-case ids", () => {
    const ids = [...FAQ_CATEGORIES.map((c) => c.id), ...allItems.map((i) => i.id)];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("every entry is a real question with a substantive answer", () => {
    for (const item of allItems) {
      expect(item.question.trim().endsWith("?"), `"${item.question}" should end with '?'`).toBe(
        true,
      );
      expect(item.answer.length).toBeGreaterThanOrEqual(1);
      for (const paragraph of item.answer) {
        expect(paragraph.trim().length).toBeGreaterThan(40);
      }
    }
  });

  it("every category is titled and described", () => {
    for (const category of FAQ_CATEGORIES) {
      expect(category.title.trim().length).toBeGreaterThan(0);
      expect(category.description.trim().length).toBeGreaterThan(0);
      expect(category.icon).toBeTruthy();
    }
  });

  it("covers the essentials a bettor and an LP must know", () => {
    const questions = allItems.map((i) => i.question.toLowerCase()).join(" ");
    for (const essential of [
      "fee",
      "slippage",
      "resolve",
      "claim",
      "liquidity",
      "tie",
      "safe",
      "beta",
    ]) {
      expect(questions, `expected a question about "${essential}"`).toContain(essential);
    }
  });
});
