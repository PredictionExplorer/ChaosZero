import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { FaqContent } from "./faq-content";
import { FAQ_CATEGORIES } from "./faq-data";

const mocks = vi.hoisted(() => ({ marketAddress: null as Address | null }));

vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return {
    ...actual,
    appConfig: {
      ...actual.appConfig,
      get marketAddress() {
        return mocks.marketAddress;
      },
    },
  };
});

beforeEach(() => {
  mocks.marketAddress = null;
});

describe("FaqContent", () => {
  it("renders the hero and one section per category", () => {
    render(<FaqContent />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/frequently asked/i);
    for (const category of FAQ_CATEGORIES) {
      const section = screen.getByTestId(`faq-section-${category.id}`);
      expect(within(section).getByRole("heading", { level: 2 })).toHaveTextContent(category.title);
      expect(section).toHaveAttribute("id", category.id);
    }
  });

  it("renders every question of every category", () => {
    render(<FaqContent />);
    for (const item of FAQ_CATEGORIES.flatMap((c) => c.items)) {
      expect(screen.getByTestId(`faq-question-${item.id}`)).toHaveTextContent(item.question);
    }
  });

  it("offers category jump links for both mobile and desktop", () => {
    render(<FaqContent />);
    const navs = screen.getAllByRole("navigation", { name: /faq categories/i });
    expect(navs).toHaveLength(2);
    for (const nav of navs) {
      for (const category of FAQ_CATEGORIES) {
        const link = within(nav).getByRole("link", { name: new RegExp(category.title, "i") });
        expect(link).toHaveAttribute("href", `#${category.id}`);
      }
    }
  });

  it("closes with links back to the market and to the game", () => {
    render(<FaqContent />);
    const outro = screen.getByTestId("faq-outro");
    expect(within(outro).getByRole("link", { name: /go to the market/i })).toHaveAttribute("href", "/");
    expect(within(outro).getByRole("link", { name: /play cosmic signature/i })).toHaveAttribute(
      "href",
      "https://cosmicsignature.com",
    );
    expect(outro).not.toHaveTextContent("Contract");
  });

  it("links the deployed market contract so answers can be verified on-chain", () => {
    mocks.marketAddress = "0xDe5bC71e94B991265B2DfDCE0921245B70c51b4d";
    render(<FaqContent />);

    const outro = screen.getByTestId("faq-outro");
    expect(outro).toHaveTextContent("Contract");
    expect(within(outro).getByRole("link", { name: "0xDe5b…1b4d" })).toHaveAttribute(
      "href",
      expect.stringMatching(/\/address\/0xDe5bC71e94B991265B2DfDCE0921245B70c51b4d$/),
    );
  });
});
