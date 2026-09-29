import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IntroHero } from "./intro-hero";

describe("IntroHero", () => {
  it("gives the page its h1, naming Cosmic Signature and gestures", () => {
    render(<IntroHero />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent(/cosmic signature/i);
    expect(heading).toHaveTextContent(/gestures/i);
  });

  it("states the one question the market asks", () => {
    render(<IntroHero />);
    expect(screen.getByTestId("intro-hero")).toHaveTextContent(
      /will this round end with more gestures than the last one\?/i,
    );
  });

  it("introduces Cosmic Signature and links out to the game safely", () => {
    render(<IntroHero />);
    expect(screen.getByTestId("intro-hero")).toHaveTextContent(/on-chain NFT game/i);

    const links = screen.getAllByRole("link", { name: /cosmic signature/i });
    expect(links.length).toBeGreaterThanOrEqual(1);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "https://cosmicsignature.com");
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    }
  });

  it("walks through the three betting steps in order", () => {
    render(<IntroHero />);
    const steps = screen.getByRole("list", { name: /three steps/i });
    const items = within(steps).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent(/pick yes or no/i);
    expect(items[1]).toHaveTextContent(/stake cst/i);
    expect(items[2]).toHaveTextContent(/pay 1 CST/i);
  });

  it("links down to the how-it-works section", () => {
    render(<IntroHero />);
    expect(screen.getByRole("link", { name: /how it works/i })).toHaveAttribute(
      "href",
      "#how-it-works",
    );
  });
});
