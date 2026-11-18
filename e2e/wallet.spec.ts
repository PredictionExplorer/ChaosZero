import { expect, test, type Page } from "@playwright/test";

import { installWallet } from "./wallet-provider";

async function expectHeaderReachable(page: Page) {
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 850 });
    const controls = page.locator("header").locator("a:visible, button:visible");
    expect(await controls.count()).toBeGreaterThanOrEqual(2);
    for (const control of await controls.all()) {
      await expect(control).toBeInViewport({ ratio: 1 });
      await control.click({ trial: true });
    }
  }
}

for (const path of ["/", "/previous?round=1"]) {
  test(`wallet network, keyboard and phone controls on ${path}`, async ({ page }) => {
    await installWallet(page);
    await page.goto(path);
    const header = page.locator("header");
    const connect = header.getByRole("button", { name: "Connect wallet" });
    await expect(connect).toBeEnabled();
    await expectHeaderReachable(page);
    await connect.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Connect a wallet" });
    const close = dialog.getByRole("button", { name: "Close" });
    await expect(close).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button").last()).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(connect).toBeFocused();
    await page.keyboard.press("Enter");
    await dialog.getByRole("button", { name: "Test wallet" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("independent-cycle")).toHaveText("Cycle 1");
    const switchNetwork = header.getByRole("button", { name: "Switch to Anvil" });
    await expect(switchNetwork).toBeEnabled();
    await expect(page.getByTestId("independent-portfolio")).toHaveCount(0);
    if (path === "/") {
      await expect(page.getByTestId("independent-active")).toHaveText("8,000 CST");
      await expect(
        page
          .getByTestId("independent-trade-panel")
          .getByRole("button", { name: "Switch to Anvil" }),
      ).toBeVisible();
    } else {
      await expect(page.getByRole("region", { name: "Previous market positions" })).toContainText(
        "Switch to Anvil",
      );
    }
    await expectHeaderReachable(page);
    await switchNetwork.click();
    await expect(page.getByTestId("independent-portfolio")).toBeVisible();
    const account = header.getByRole("button", { name: /0x7099/ });
    await expect(account).toHaveAttribute("aria-expanded", "false");
    await expectHeaderReachable(page);
    await account.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await expect(header.getByRole("button", { name: "Disconnect" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(account).toBeFocused();
    await expect(account).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(connect).toBeVisible();
    await expect(page.getByTestId("independent-portfolio")).toHaveCount(0);
  });
}

test("FAQ nav remains named and reachable at desktop and phone widths", async ({ page }) => {
  await page.goto("/faq");
  await expectHeaderReachable(page);
  const header = page.locator("header");
  await expect(header.getByRole("link", { name: /chaoszero/i })).toBeInViewport();
  await header.getByRole("link", { name: "Market", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Eight ways/ })).toBeVisible();
});
