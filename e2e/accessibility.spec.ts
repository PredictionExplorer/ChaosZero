import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { installWallet } from "./wallet-provider";

async function checkAccessibility(page: Page, testInfo: TestInfo, state: string) {
  await page.evaluate(() => document.fonts.ready);
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze();
  await testInfo.attach(state, {
    body: JSON.stringify(violations, null, 2),
    contentType: "application/json",
  });
  expect(
    violations.map(({ id, nodes }) => ({ id, elements: nodes.map((node) => node.target) })),
    state,
  ).toEqual([]);
}

for (const width of [1280, 320]) {
  test.describe(`WCAG A/AA at ${width}px`, () => {
    test.use({ viewport: { width, height: 850 }, reducedMotion: "reduce" });

    for (const path of ["/faq", "/baseline"]) {
      test(path, async ({ page }, testInfo) => {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await checkAccessibility(page, testInfo, path.slice(1));
      });
    }

    for (const path of ["/", "/previous?round=1"]) {
      test(`market and wallet states on ${path}`, async ({ page }, testInfo) => {
        await installWallet(page);
        await page.goto(path);
        await expect(page.getByTestId("independent-cycle")).toBeVisible();
        const header = page.locator("header");
        await checkAccessibility(page, testInfo, "disconnected");
        await header.getByRole("button", { name: "Connect wallet" }).click();
        const dialog = page.getByRole("dialog", { name: "Connect a wallet" });
        await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
        if (path === "/") {
          // Sample the final text colors after the backdrop and panel have faded in.
          await expect(dialog).toHaveCSS("opacity", "1");
          await expect(dialog.locator(":scope > div")).toHaveCSS("opacity", "1");
          await checkAccessibility(page, testInfo, "wallet-picker");
        }
        await dialog.getByRole("button", { name: "Test wallet" }).click();
        await header.getByRole("button", { name: "Switch to Anvil" }).click();
        await expect(page.getByTestId("independent-portfolio")).toBeVisible();
        await checkAccessibility(page, testInfo, "connected");
      });
    }
  });
}
