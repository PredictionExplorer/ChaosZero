import type { ConsoleMessage, Page } from "@playwright/test";
import { expect, test as base } from "@playwright/test";
import { LocalChain } from "./support/chain";
import { BASE_URL, localChainEnv, requireLocalChainEnv } from "./support/env";
import { MarketPage } from "./support/market-page";

/**
 * Console errors that are genuinely benign and may be ignored. Keep every
 * entry exact and commented: each one hides a whole class of real bugs.
 * (Empty on purpose — the app currently logs no errors at all.)
 */
const ALLOWED_CONSOLE_ERRORS: readonly RegExp[] = [];

function describeConsoleError(message: ConsoleMessage): string {
  const { url, lineNumber } = message.location();
  return `console.error: ${message.text()}${url ? ` (${url}:${lineNumber})` : ""}`;
}

interface Fixtures {
  /** The local anvil chain the app is built against, reset to its pristine post-deploy state. */
  chain: LocalChain;
  /** Page object for the market screen. */
  market: MarketPage;
}

interface AutoFixtures {
  /** Rewinds the local chain before every test, so no test sees another's transactions. */
  pristineChain: void;
  /** Fails the test on console errors, uncaught exceptions, or requests leaving the local stack. */
  pageHealth: void;
}

// Fixture bodies name Playwright's `use` callback `provide`: the app's React
// lint rules would otherwise mistake it for React's `use` hook.
export const test = base.extend<Fixtures & AutoFixtures>({
  pristineChain: [
    async ({}, provide) => {
      const env = localChainEnv();
      if (env !== null) await (await LocalChain.connect(env)).resetToPristine();
      await provide();
    },
    { auto: true },
  ],

  pageHealth: [
    async ({ context }, provide) => {
      const problems: string[] = [];
      const chainEnv = localChainEnv();
      // Against the local stack nothing may leave the machine: the app talks
      // to its own server and to anvil, and that is all. (A remote deployment
      // legitimately talks to its RPC provider, so the check is local-only.)
      const allowedOrigins = new Set([new URL(BASE_URL).origin]);
      if (chainEnv !== null) allowedOrigins.add(new URL(chainEnv.rpcUrl).origin);

      const watch = (page: Page) => {
        page.on("console", (message) => {
          if (message.type() !== "error") return;
          if (ALLOWED_CONSOLE_ERRORS.some((pattern) => pattern.test(message.text()))) return;
          problems.push(describeConsoleError(message));
        });
        page.on("pageerror", (error) => problems.push(`uncaught ${error.name}: ${error.message}`));
      };
      context.pages().forEach(watch);
      context.on("page", watch);
      if (chainEnv !== null) {
        context.on("request", (request) => {
          const url = new URL(request.url());
          if (url.protocol.startsWith("http") && !allowedOrigins.has(url.origin)) {
            problems.push(`request to a third party: ${request.method()} ${request.url()}`);
          }
        });
      }

      await provide();

      expect(problems, "the page logged errors, threw, or reached outside the local stack").toEqual(
        [],
      );
    },
    { auto: true },
  ],

  chain: async ({}, provide) => {
    await provide(await LocalChain.connect(requireLocalChainEnv()));
  },

  market: async ({ page }, provide) => {
    await provide(new MarketPage(page));
  },
});

export { expect };
