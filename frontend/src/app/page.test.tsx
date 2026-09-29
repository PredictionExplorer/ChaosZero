import { render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { parseHtml, readJsonLd } from "@/test/html";
import Home from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

/**
 * The homepage contract: everything explanatory is in the server HTML, so
 * crawlers, AI agents and first paint never wait for wallet JavaScript.
 */
describe("Home page — server-rendered HTML", () => {
  const page = () => parseHtml(renderToString(<Home />));

  it("leads with the hero's h1 explaining the market", () => {
    const h1 = page().querySelector("h1");
    expect(h1?.textContent).toMatch(/cosmic signature/i);
  });

  it("includes the header navigation, how-it-works and the footer", () => {
    const html = page();
    expect(html.querySelector('nav[aria-label="Primary"]')).not.toBeNull();
    expect(html.querySelector("#how-it-works")).not.toBeNull();
    expect(html.querySelector("footer")?.textContent).toMatch(/zero oracles/i);
  });

  it("publishes the Organization, WebSite and WebApplication structured data", () => {
    const types = readJsonLd(page()).map((node) => node["@type"]);
    expect(types).toEqual(["Organization", "WebSite", "WebApplication"]);
  });

  it("renders a hydration-safe wallet placeholder in the header", () => {
    const button = [...page().querySelectorAll("header button")].find((b) => b.textContent === "Connect");
    expect(button).toBeDefined();
    expect(button).toHaveProperty("disabled", true);
  });
});

describe("Home page — in the browser", () => {
  /** Renders the page and lets wagmi finish restoring any previous session. */
  async function renderHome() {
    render(<Home />);
    const connect = screen.getByRole("button", { name: "Connect wallet" });
    await waitFor(() => expect(connect).toBeEnabled());
    return connect;
  }

  it("activates the wallet button once hydrated", async () => {
    expect(await renderHome()).toBeEnabled();
  });

  it("explains how to point the app at a market when none is configured", async () => {
    await renderHome();
    expect(screen.getByTestId("no-market")).toBeInTheDocument();
  });

  it("marks Market as the current page", async () => {
    await renderHome();
    expect(screen.getByRole("link", { name: "Market" })).toHaveAttribute("aria-current", "page");
  });
});
