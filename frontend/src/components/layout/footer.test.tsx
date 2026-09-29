import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { COSMIC_GAME_ADDRESS, appConfig } from "@/lib/config";
import { CST, SERIES } from "@/test/fixtures";
import { Footer } from "./footer";

/** The explorer link rendered for `address` (AddressLink shows it shortened). */
function explorerLinkFor(address: string): HTMLElement | undefined {
  return screen
    .queryAllByRole("link")
    .find((link) => link.getAttribute("href")?.toLowerCase().endsWith(address.toLowerCase()));
}

describe("Footer", () => {
  it("states what the product is and its trust model", () => {
    render(<Footer marketAddress={null} cstAddress={null} />);

    const footer = screen.getByRole("contentinfo");
    expect(footer).toHaveTextContent(/fully collateralized YES\/NO prediction market/i);
    expect(footer).toHaveTextContent(appConfig.chain.name);
    expect(footer).toHaveTextContent(/zero oracles, zero admin keys, zero custody/i);
  });

  it("carries a risk disclaimer", () => {
    render(<Footer marketAddress={null} cstAddress={null} />);
    expect(screen.getByText(/bet only what you can afford to lose/i)).toBeInTheDocument();
  });

  it("always links the Cosmic Signature game contract", () => {
    render(<Footer marketAddress={null} cstAddress={null} />);

    expect(explorerLinkFor(COSMIC_GAME_ADDRESS)).toBeDefined();
    expect(screen.queryByText("Market")).not.toBeInTheDocument();
    expect(screen.queryByText("CST")).not.toBeInTheDocument();
  });

  it("links the market and CST contracts when they are known", () => {
    render(<Footer marketAddress={SERIES} cstAddress={CST} />);

    expect(screen.getByText("Market")).toBeInTheDocument();
    expect(screen.getByText("CST")).toBeInTheDocument();
    expect(explorerLinkFor(SERIES)).toBeDefined();
    expect(explorerLinkFor(CST)).toBeDefined();
    expect(explorerLinkFor(COSMIC_GAME_ADDRESS)).toBeDefined();
  });
});
