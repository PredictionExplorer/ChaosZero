import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

async function expectLiveLocalMarkets(page: Page) {
  await expect(page.getByRole("heading", { level: 1, name: /Eight ways/ })).toBeVisible();
  await expect(page.getByText("LOCAL TEST NETWORK", { exact: true })).toBeVisible();
  await expect(page.getByText("TEST FUNDS ONLY", { exact: true })).toBeVisible();
  await expect(page.getByTestId("independent-cycle")).toHaveText("Cycle 1");
  await expect(page.getByTestId("independent-active")).toHaveText("10,000 CST");
  await expect(page.getByTestId(/^question-\d$/)).toHaveCount(8);
  for (let question = 0; question < 8; question++) {
    const card = page.getByTestId(`question-${question}`);
    await expect(card).toBeVisible();
    await expect(card.getByTestId(`question-collateral-${question}`)).toHaveText("1,250 CST");
    await expect(card.getByRole("button", { name: /^Buy YES:/ })).toBeEnabled();
    await expect(card.getByRole("button", { name: /^Buy NO:/ })).toBeEnabled();
    await expect(card.getByTestId(`question-seed-${question}`)).toHaveText("50%");
  }
  await expect(page.getByTestId("current-0")).toHaveText("0");
}

async function expectContentFitsViewport(page: Page) {
  const layout = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    // Also inspect interactive content: overflow-x:hidden must not disguise
    // controls or headings that have been clipped outside the viewport.
    const clipped = [...document.querySelectorAll("main h1, main h2, a, button, input, select")]
      .filter((element) => {
        const bounds = element.getBoundingClientRect();
        return (
          bounds.width > 0 && bounds.height > 0 && (bounds.left < -1 || bounds.right > width + 1)
        );
      })
      .map(
        (element) => element.getAttribute("aria-label") || element.textContent?.trim().slice(0, 80),
      );
    return { width, scrollWidth: document.documentElement.scrollWidth, clipped };
  });
  expect(layout.scrollWidth, "The page must not scroll horizontally").toBeLessThanOrEqual(
    layout.width + 1,
  );
  expect(
    layout.clipped,
    "Controls and headings must stay usable without horizontal scrolling",
  ).toEqual([]);
}

test("homepage remains usable at desktop and narrow mobile widths", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expectLiveLocalMarkets(page);
  await page.evaluate(() => document.fonts.ready);
  await expectContentFitsViewport(page);
  await mkdir(path.resolve(".local"), { recursive: true });
  await page.screenshot({
    path: path.resolve(".local/chaos-zero-homepage-hero.png"),
    fullPage: false,
  });
  await page.screenshot({
    path: path.resolve(".local/chaos-zero-homepage-desktop.png"),
    fullPage: true,
  });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expectLiveLocalMarkets(page);
    await expectContentFitsViewport(page);
    if (width === 390)
      await page.screenshot({
        path: path.resolve(".local/chaos-zero-homepage-mobile.png"),
        fullPage: true,
      });
  }
  expect(errors).toEqual([]);
});

test("keyboard navigation, reduced motion and supporting information work", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expectLiveLocalMarkets(page);
  const primary = page.getByRole("link", { name: "Explore the markets", exact: true });
  for (let tabs = 0; tabs < 16; tabs++) {
    await page.keyboard.press("Tab");
    if (await primary.evaluate((element) => element === document.activeElement)) break;
  }
  await expect(primary).toBeFocused();
  const focus = await primary.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      width: parseFloat(style.outlineWidth),
      style: style.outlineStyle,
      color: style.outlineColor,
    };
  });
  expect(focus.width).toBeGreaterThanOrEqual(2);
  expect(focus.style).not.toBe("none");
  expect(focus.color).not.toBe("rgba(0, 0, 0, 0)");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#markets$/);
  await expect(page.getByRole("region", { name: "Eight prediction markets" })).toBeInViewport();
  // Decorative hero movement must honor the actual user preference, including SVG rings.
  const animationNames = await page
    .locator(".hero-copy, .orbital-art, .orbital-rings")
    .evaluateAll((elements) => elements.map((element) => getComputedStyle(element).animationName));
  expect(animationNames).toHaveLength(3);
  expect(animationNames).toEqual(["none", "none", "none"]);
  const footer = page.getByRole("navigation", { name: "Footer navigation" });
  const faq = footer.getByRole("link", { name: "FAQ", exact: true });
  await expect(faq).toHaveAttribute("href", "/faq");
  await faq.click();
  await expect(page).toHaveURL(/\/faq$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/FAQ|questions/i);
  await page.goto("/");
  const baseline = page
    .getByRole("navigation", { name: "Footer navigation" })
    .getByRole("link", { name: /baseline/i });
  await expect(baseline).toHaveAttribute("href", "/baseline");
  await baseline.click();
  await expect(page).toHaveURL(/\/baseline$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("main")).toContainText(
    "This is not an on-chain receipt-proof verifier.",
  );
  await expect(page.getByRole("link", { name: "Evidence JSON", exact: true })).toHaveAttribute(
    "href",
    "/baseline.json",
  );
  const evidenceResponse = await page.request.get("/baseline.json");
  expect(evidenceResponse.ok()).toBe(true);
  const evidence = await evidenceResponse.json();
  expect(evidence.baselineRound).toBe("2");
  expect(evidence.firstMarketRound).toBe("3");
  expect(evidence.values.gestureCount).toBe("1257");
});
