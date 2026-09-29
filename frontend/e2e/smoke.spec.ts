import { expect, test } from "./fixtures";

/**
 * Smoke: every page renders, hydrates and navigates without a single console
 * error (enforced for every test by the `pageHealth` fixture), and the
 * machine-readable routes answer. Chain-agnostic, so it also runs against a
 * deployed preview via E2E_BASE_URL, and on the mobile project.
 */
test.describe("smoke", { tag: "@smoke" }, () => {
  test("home page renders the pitch, the live market and the explainer", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle(/Chaos Zero/);
    await expect(page.getByRole("heading", { level: 1, name: "Bet on Cosmic Signature gestures" })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Market" }),
    ).toHaveAttribute("aria-current", "page");

    // The client island hydrated and read the market from the chain.
    await expect(page.getByRole("navigation", { name: "Round navigation" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Place bet" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Place your bet" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("button", { name: "Connect wallet", exact: true })).toBeEnabled();

    // Server-rendered explainer and footer.
    await expect(page.getByRole("region", { name: "How it works" })).toBeVisible();
    await expect(page.getByRole("contentinfo")).toContainText("Prediction markets involve risk");
  });

  for (const path of ["/", "/faq"]) {
    test(`every header control on ${path} is reachable: nothing covers another`, async ({ page }) => {
      await page.goto(path);
      const banner = page.getByRole("banner");
      // Once hydrated, the header's action slot has its final (widest) content.
      if (path === "/") await expect(banner.getByRole("button", { name: "Connect wallet", exact: true })).toBeEnabled();

      // This project's viewport, then 320 px: the narrowest width WCAG 1.4.10
      // (Reflow) requires to work without losing functionality.
      for (const viewport of [page.viewportSize(), { width: 320, height: 640 }]) {
        if (viewport) await page.setViewportSize(viewport);
        const controls = await banner.locator("a:visible, button:visible").all();
        expect(controls.length).toBeGreaterThanOrEqual(3);
        for (const control of controls) {
          // A trial click runs every actionability check, including that the
          // control itself (not something drawn over it) receives the pointer.
          await control.click({ trial: true, timeout: 5_000 });
        }
      }
    });
  }

  test("header navigation moves between the market and the FAQ", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Primary" });

    await nav.getByRole("link", { name: "FAQ" }).click();
    await expect(page).toHaveURL(/\/faq$/);
    await expect(page.getByRole("heading", { level: 1, name: "Frequently asked questions" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "FAQ" })).toHaveAttribute("aria-current", "page");

    await nav.getByRole("link", { name: "Market" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "Bet on Cosmic Signature gestures" })).toBeVisible();
  });

  test("FAQ answers expand and collapse, and match the structured data", async ({ page }) => {
    await page.goto("/faq");
    await expect(page).toHaveTitle(/^FAQ — Chaos Zero/);
    await expect(page.getByRole("heading", { level: 1, name: "Frequently asked questions" })).toBeVisible();
    // The FAQ ships no wallet code: no connect button in its header.
    await expect(page.getByRole("banner").getByRole("button", { name: /connect/i })).toHaveCount(0);

    const question = page.getByRole("button", { name: "What is Chaos Zero?", exact: true });
    const answer = page.getByRole("region", { name: "What is Chaos Zero?", exact: true });
    await expect(question).toHaveAttribute("aria-expanded", "false");
    await expect(answer).toBeHidden();
    await question.click();
    await expect(question).toHaveAttribute("aria-expanded", "true");
    await expect(answer).toBeVisible();
    await question.click();
    await expect(question).toHaveAttribute("aria-expanded", "false");
    await expect(answer).toBeHidden();

    // Every question on the page is in the FAQPage JSON-LD, and nothing else is.
    const questions = await page.getByRole("main").locator("button[aria-expanded]").allTextContents();
    const faqPage = (await page.locator('script[type="application/ld+json"]').allTextContents())
      .map((json) => JSON.parse(json) as { "@type"?: string; mainEntity?: { name: string }[] })
      .find((node) => node["@type"] === "FAQPage");
    expect(faqPage?.mainEntity?.map((entry) => entry.name)).toEqual(questions.map((text) => text.trim()));
  });

  test("machine-readable routes answer", async ({ request }) => {
    const llms = await request.get("/llms.txt");
    expect(llms.status()).toBe(200);
    expect(llms.headers()["content-type"]).toContain("text/plain");
    const llmsText = await llms.text();
    expect(llmsText).toMatch(/^# Chaos Zero\n/);
    expect(llmsText).toContain("/faq");

    const llmsFull = await request.get("/llms-full.txt");
    expect(llmsFull.status()).toBe(200);
    expect(await llmsFull.text()).toContain("What is Chaos Zero?");

    const robots = await request.get("/robots.txt");
    expect(robots.status()).toBe(200);
    const robotsText = await robots.text();
    expect(robotsText).toContain("User-Agent: *");
    expect(robotsText).toMatch(/^Sitemap: https?:\/\/\S+\/sitemap\.xml$/m);

    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    expect(sitemap.headers()["content-type"]).toContain("xml");
    const sitemapXml = await sitemap.text();
    expect(sitemapXml).toContain("<urlset");
    expect(sitemapXml).toMatch(/<loc>https?:\/\/[^<]+\/faq<\/loc>/);

    const manifest = await request.get("/manifest.webmanifest");
    expect(manifest.status()).toBe(200);
    expect(await manifest.json()).toMatchObject({ short_name: "Chaos Zero", start_url: "/" });

    // Social cards are generated at build time; a broken font or layout shows up here.
    for (const card of ["/opengraph-image", "/twitter-image"]) {
      const image = await request.get(card);
      expect(image.status(), card).toBe(200);
      expect(image.headers()["content-type"], card).toBe("image/png");
      expect((await image.body()).byteLength, card).toBeGreaterThan(10_000);
    }
  });

  test("unknown routes answer 404", async ({ request }) => {
    const response = await request.get("/this-page-does-not-exist");
    expect(response.status()).toBe(404);
  });
});
