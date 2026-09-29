import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { parseEther } from "viem";
import { expect, test } from "./fixtures";
import { ACCOUNTS } from "./support/chain";

/** Every WCAG 2.0 / 2.1 / 2.2 success criterion at levels A and AA that axe can check. */
const WCAG_A_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * Runs axe over the page (or one part of it), attaches the full report to the
 * test, and fails on ANY violation — whatever its impact, a WCAG A/AA failure
 * is a conformance failure. Violations print as one readable line per rule.
 */
async function expectNoViolations(page: Page, testInfo: TestInfo, include?: string): Promise<void> {
  const builder = new AxeBuilder({ page }).withTags(WCAG_A_AA);
  if (include) builder.include(include);
  const results = await builder.analyze();
  await testInfo.attach(`axe${include ? ` ${include}` : ""}.json`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: "application/json",
  });
  const summary = results.violations.map(
    (v) => `${v.id} [${v.impact}] ${v.help} — ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
  );
  expect(summary, "axe WCAG 2.x A/AA violations").toEqual([]);
}

test.describe("accessibility", { tag: "@a11y" }, () => {
  test("home page", async ({ page }, testInfo) => {
    await page.goto("/");
    // Scan the hydrated market, not the loading skeleton.
    await expect(page.getByRole("heading", { name: "Place your bet" })).toBeVisible();
    await expectNoViolations(page, testInfo);
  });

  test("FAQ page, with an answer expanded", async ({ page }, testInfo) => {
    await page.goto("/faq");
    const question = page.getByRole("button", { name: "What is Chaos Zero?", exact: true });
    await question.click();
    await expect(question).toHaveAttribute("aria-expanded", "true");
    await expectNoViolations(page, testInfo);
  });

  test("wallet dialog", async ({ page }, testInfo) => {
    await page.goto("/");
    await page.getByRole("banner").getByRole("button", { name: "Connect wallet", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Connect a wallet" });
    await expect(dialog).toBeVisible();
    await expectNoViolations(page, testInfo, '[role="dialog"]');

    // Escape closes it (keyboard users are never trapped).
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test(
    "market with a connected wallet holding bets and liquidity",
    { tag: "@chain" },
    async ({ market, chain }, testInfo) => {
      const round = await chain.currentRound();
      await chain.bet(ACCOUNTS.wallet, "yes", round, parseEther("250"));
      await chain.addLiquidity(ACCOUNTS.wallet, round, parseEther("500"), 300);

      await market.goto();
      await market.connectWallet();
      await expect(market.positionPanel).toBeVisible();
      await expectNoViolations(market.page, testInfo);

      await market.openTab("Liquidity");
      await expect(market.liquidityPanel.getByTestId("lp-position")).toBeVisible();
      await expectNoViolations(market.page, testInfo);
    },
  );

  test("round awaiting resolution", { tag: "@chain" }, async ({ market, chain }, testInfo) => {
    const round = await chain.currentRound();
    const { threshold } = await chain.roundState(round);
    await chain.bet(ACCOUNTS.wallet, "no", round, parseEther("100"));
    await chain.setGestureCount(round, threshold - 1n);
    await chain.setGameRound(round + 1n);

    await market.goto(round);
    await market.connectWallet();
    await expect(market.resolveBanner).toBeVisible();
    await expectNoViolations(market.page, testInfo);
  });
});
