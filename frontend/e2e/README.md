# End-to-end tests

The production build of the app, in a real browser, against the real
`GestureSeriesMarket` bytecode on a throwaway anvil chain.

```bash
tools/e2e.sh                                    # from the repo root: provision everything, run all projects
tools/e2e.sh --project=chromium --grep @chain   # any `playwright test` arguments pass through
E2E_SKIP_BUILD=1 tools/e2e.sh                   # reuse the last e2e build while iterating on specs
```

`tools/e2e.sh` starts anvil on `127.0.0.1:8545`, broadcasts
`script/DeployLocal.s.sol` (mock game, mock CST, the market, a seeded pool),
reads the addresses from forge's broadcast record, runs `next build` against
that deployment, serves it with `next start`, and runs Playwright. anvil and
next are stopped on exit, including on Ctrl-C and failures; their logs land in
`.logs/e2e/`, the HTML report in `frontend/playwright-report/`
(`pnpm exec playwright show-report`).

Needs Foundry, Node and pnpm, and Playwright's Chromium once:
`pnpm exec playwright install chromium` (add `--with-deps` on a bare Linux
box). Where browsers cannot be downloaded, point
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` at a local Chromium.

## Suites

| Tag      | Spec             | What it proves                                                                                                   |
| -------- | ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| `@smoke` | `smoke.spec.ts`  | Pages render and hydrate, navigation works, header controls stay reachable down to 320 px, SEO/AI routes answer. |
| `@a11y`  | `a11y.spec.ts`   | Zero axe violations against WCAG 2.0/2.1/2.2 A and AA, including the wallet dialog and connected states.         |
| `@chain` | `market.spec.ts` | Bets, liquidity, fee claims, withdrawals, early and normal resolution, and claims, through the UI.               |

The `chromium` project runs everything; the `mobile` project (Pixel 7) runs
`@smoke`. Against a deployed preview, run the chain-agnostic suites with
`E2E_BASE_URL=https://… pnpm test:e2e --grep-invert @chain`.

## Rules the fixtures enforce (`fixtures.ts`)

- **No console errors, no uncaught exceptions** in any test. There is no
  allowlist today; add an entry only for a genuinely benign message, exactly
  matched and commented.
- **Hermetic:** against the local stack, any request to an origin other than
  the app and anvil fails the test.
- **Isolated:** the global setup snapshots the pristine post-deploy chain, and
  every test starts by rewinding to it (`evm_revert`, then a fresh snapshot).
  Tests share one chain, so they run in a single worker.

## Writing specs

- Locate by role and accessible name, as a user or screen reader would; use
  the app's `data-testid`s only for bare numbers with no label of their own.
- Check every number the UI shows against the contract's own view functions
  (`support/chain.ts`), rendered through the app's formatter.
- Arrange state through the contract (`chain.bet`, `chain.addLiquidity`,
  `chain.setGestureCount`, …) and exercise only the flow under test in the UI.
- Web-first assertions only; no fixed sleeps. A change made from Node reaches
  the UI on its next poll: use `LIVE_UPDATE_TIMEOUT` for those assertions.
- On chain 31337 the app's Mock Connector signs with anvil account #1
  (`ACCOUNTS.wallet`) and always talks to `127.0.0.1:8545`, whatever
  `NEXT_PUBLIC_RPC_URL` says, which is why the port is fixed.
