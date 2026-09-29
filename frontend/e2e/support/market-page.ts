import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { shortAddress } from "../../src/lib/format";
import type { Side } from "./chain";
import { ACCOUNTS } from "./chain";

/**
 * The app polls the chain every 8 s (REFRESH_MS in src/hooks/use-market.ts),
 * so a change made from Node — not by the app's own transaction, which
 * refreshes immediately — needs up to one polling interval to appear.
 */
export const LIVE_UPDATE_TIMEOUT = 20_000;

/**
 * Page object for the market screen. Locators follow what a user (or a
 * screen reader) perceives — landmarks, roles and accessible names — and fall
 * back to the app's test ids only for bare numbers that have no label of
 * their own.
 */
export class MarketPage {
  readonly header: Locator;
  readonly roundNav: Locator;
  readonly tradeTabs: Locator;
  readonly betPanel: Locator;
  readonly liquidityPanel: Locator;
  readonly positionPanel: Locator;
  readonly resolveBanner: Locator;
  readonly activity: Locator;
  readonly probability: Locator;

  constructor(readonly page: Page) {
    this.header = page.getByRole("banner");
    this.roundNav = page.getByRole("navigation", { name: "Round navigation" });
    this.tradeTabs = page.getByRole("tablist", { name: "Trade actions" });
    this.betPanel = page.getByRole("tabpanel", { name: "Place bet" });
    this.liquidityPanel = page.getByRole("tabpanel", { name: "Liquidity" });
    this.positionPanel = page.getByTestId("position-panel");
    this.resolveBanner = page.getByTestId("resolve-banner");
    this.activity = page.getByTestId("activity-feed").getByRole("listitem");
    this.probability = page.getByTestId("hero-probability");
  }

  /** Opens the market (optionally pinned to a round) and waits for its first chain read. */
  async goto(round?: bigint): Promise<void> {
    await this.page.goto(round === undefined ? "/" : `/?round=${round}`);
    await expect(this.roundNav).toBeVisible();
  }

  /** The round the screen currently shows, as its navigation announces it. */
  currentRoundLabel(round: bigint): Locator {
    return this.roundNav.getByText(`Round ${round}`, { exact: true });
  }

  /** Connects anvil account #1 through the app's own wallet dialog (Mock Connector). */
  async connectWallet(): Promise<void> {
    await this.header.getByRole("button", { name: "Connect wallet", exact: true }).click();
    const dialog = this.page.getByRole("dialog", { name: "Connect a wallet" });
    await dialog.getByRole("button", { name: "Mock Connector" }).click();
    await expect(dialog).toBeHidden();
    await expect(
      this.header.getByRole("button", { name: shortAddress(ACCOUNTS.wallet) }),
    ).toBeVisible();
  }

  async openTab(name: "Place bet" | "Liquidity"): Promise<void> {
    const tab = this.tradeTabs.getByRole("tab", { name });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
  }

  /** A sonner toast, by its exact message. */
  toast(message: string): Locator {
    return this.page
      .getByRole("region", { name: /^Notifications/ })
      .getByText(message, { exact: true });
  }

  /** Activity feed entries containing `text`. */
  activityItem(text: string): Locator {
    return this.activity.filter({ hasText: text });
  }

  // ------------------------------------------------------------- betting

  betAmount(): Locator {
    return this.betPanel.getByRole("textbox", { name: "Amount" });
  }

  async chooseSide(side: Side): Promise<void> {
    const tab = this.betPanel.getByRole("tab", {
      name: side === "yes" ? "Yes" : "No",
      exact: true,
    });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
  }

  /** Approves exactly the typed amount, then submits the bet, as a first-time user would. */
  async approveAndBet(side: Side): Promise<void> {
    const label = side === "yes" ? "Bet YES" : "Bet NO";
    await this.betPanel.getByRole("button", { name: "Approve CST" }).click();
    await this.betPanel.getByRole("button", { name: label, exact: true }).click();
    await expect(this.toast(`Betting ${side.toUpperCase()} confirmed.`)).toBeVisible();
  }
}
