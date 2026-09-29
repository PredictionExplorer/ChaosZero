import { defineConfig, devices } from "@playwright/test";
import { BASE_URL, WEB_PORT } from "./e2e/support/env";

/**
 * End-to-end tests: the production build of the app, in a real browser,
 * against the real GestureSeriesMarket contract on a local anvil chain.
 *
 *   tools/e2e.sh                  # provisions everything, then runs this suite
 *   tools/e2e.sh --project=chromium --grep @chain
 *   pnpm test:e2e                 # against a stack that is already up (see e2e/support/env.ts)
 *
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH runs a locally installed Chromium
 * instead of the revision pinned by @playwright/test, for machines that
 * cannot download browsers; CI always uses the pinned one.
 */
const CI = !!process.env.CI;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim() || undefined;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  globalSetup: "./e2e/global-setup.ts",

  // Every test shares ONE chain and rewinds it to the pristine snapshot
  // before it starts, so tests must never overlap: one worker, in order.
  fullyParallel: false,
  workers: 1,

  forbidOnly: CI,
  retries: CI ? 1 : 0,
  // Bounded everywhere: a hung transaction fails fast instead of eating the job.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: CI ? [["list"], ["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: BASE_URL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // A trace (DOM snapshots, network, console, per-action screenshots) is
    // the debugging artifact: kept for every failed attempt, so even the
    // first failure in CI is debuggable from the uploaded report.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
  },

  projects: [
    // Desktop runs everything: smoke, accessibility and the on-chain market flows.
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Phones get the smoke suite: layout, navigation and routes at a small viewport.
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@smoke/ },
  ],

  // `next start` on the production build. tools/e2e.sh starts the server
  // itself and sets E2E_BASE_URL, and so does anyone testing a deployment.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `pnpm exec next start --hostname 127.0.0.1 --port ${WEB_PORT}`,
        url: BASE_URL,
        reuseExistingServer: !CI,
        timeout: 60_000,
        stdout: "ignore",
        stderr: "pipe",
      },
});
