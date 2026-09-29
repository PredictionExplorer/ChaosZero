import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/** The narrowest width WCAG 1.4.10 (Reflow) requires to work without losing functionality. */
export const NARROWEST_VIEWPORT = { width: 320, height: 640 };

/**
 * Asserts that every visible link and button in the header receives its own
 * pointer events, at the page's current viewport and then at 320 px: nothing
 * in the header is drawn over another control. Call it once the header's
 * action slot shows the state under test (it is the widest element).
 */
export async function expectHeaderControlsReachable(page: Page): Promise<void> {
  const banner = page.getByRole("banner");
  for (const viewport of [page.viewportSize(), NARROWEST_VIEWPORT]) {
    if (viewport) await page.setViewportSize(viewport);
    const controls = await banner.locator("a:visible, button:visible").all();
    expect(controls.length).toBeGreaterThanOrEqual(3);
    for (const control of controls) {
      // A trial click runs every actionability check, including that the
      // control itself (not something drawn over it) receives the pointer.
      await control.click({ trial: true, timeout: 5_000 });
    }
  }
}
