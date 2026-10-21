# Chaos Zero frontend

An eight-market interface for Cosmic Signature on Arbitrum One. Every cycle has
separate YES/NO pools for eight questions, with **50% / 50% opening prices**.
The homepage is the independent-market interface; it does not select the retired
single-question interface or interpret a `?market=` override.

## Current release state

Production builds now use the verified Arbitrum One deployment:

- Market: `0x2BC4759A2b44e1197EAdc4E035Eb8c52299658d2`
- Outcome source: `0x099c29624E05506582655417344A17FB71c9d138`

The configuration is committed in `.env.production` and contains only public
addresses. The frontend has not been published by this configuration change.
Actual on-chain liquidity and wallet balances are read from the new market;
an unfunded market remains visibly unfunded. A missing market address still renders
the prelaunch board, and an unavailable RPC is shown as unavailable.

The V3 integration supports immutable outcome adapters with a verified historical
baseline. Historical data must not be silently replaced with zero. The adapter
exposes whether each metrics record is supported, and the interface leaves
unsupported comparisons unavailable.

## Local development

From the repository root:

```sh
pnpm setup:dev
pnpm dev:local
```

This starts disposable Anvil infrastructure and the frontend with the matching
local market address. The homepage and `/shared` render the same eight markets.
Anvil wallets, faucet, simulator gestures, cycle closure, direct test transfers
and clock controls are enabled only on chain **31337**. No real wallet key is
needed. Local funding is disposable fake CST.

For the prelaunch frontend alone:

```sh
pnpm --dir frontend dev
```

The default chain is Arbitrum One. A missing independent market address renders
the prelaunch board without enabling writes.

## Production configuration

| Variable                                 | Purpose                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_CHAIN_ID`                   | `42161` for Arbitrum One; `31337` for the local simulator.                     |
| `NEXT_PUBLIC_INDEPENDENT_MARKET_ADDRESS` | The newly deployed `IndependentOutcomeMarket`. Blank means prelaunch.          |
| `NEXT_PUBLIC_INDEPENDENT_SOURCE_ADDRESS` | Separately pinned production `V3OutcomeSource`; required for real-CST trading. |
| `NEXT_PUBLIC_RPC_URL`                    | Optional RPC endpoint for the selected chain.                                  |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`   | Optional WalletConnect project for mobile wallets.                             |
| `NEXT_PUBLIC_SITE_URL`                   | Canonical origin; defaults to `https://chaoszero.com`.                         |
| `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`   | Optional Google Search Console verification.                                   |
| `NEXT_PUBLIC_BING_SITE_VERIFICATION`     | Optional Bing verification.                                                    |

These public variables are embedded at build time. `.env.production` selects the
verified market and source above. Hosting environment values can override this
file, so they must match when the frontend is eventually published. Do not point
the independent ABI at `GestureSeriesMarket`.

To preview the configured production build locally without publishing it:

```sh
pnpm --dir frontend build
pnpm --dir frontend start --hostname 127.0.0.1 --port 3000
```

This preview uses real Arbitrum contracts and CST, not simulator balances.
`pnpm dev:local` continues to start the separate disposable simulator.

Production reads and writes validate the market's CST, source and game references
against the deployment configuration and the known Arbitrum addresses. The wallet
and RPC must agree with the configured network. Transaction gas is estimated for
each operation with headroom, including settlement and rollover on a cycle's first
trade. The local-only control path remains disabled on public chains.

Game: `0x6a714Ae7B5b6eA520F6BCA23d2E609C4Fd5863F2`.
CST: `0xAD91843e6A58Ba560F577E676986AFb1dba6FBA0`.

## Trading and accounting

Each question displays its own collateral, remaining reserve, current YES/NO
prices, and verified game metrics. Every new cycle starts at 50/50; price history
does not seed a future cycle. Exact quotes are calculated with BigInt and checked
by the contract. Changes in state may invalidate a quote and require a refresh.

The interface supports buys/sells, ERC-1155 position transfers, complete-set
splits/merges, settlement, winning claims, and funding. Winning shares pay exactly
1 CST. Contributions are irreversible gifts with no LP shares or withdrawal
rights, and are allocated equally across the eight pools. Unpaid claims remain
in a separate vault while unused pool funds carry forward.

Markets remain open until the game round-ending transaction. Known answers and
elapsed countdowns do not close them. Questions whose outcome is already known
can consume their own funding. Game participants can influence outcomes.

`?round=N` selects an explicit cycle. On outcome-data failure, recovery reads
owned positions directly from the market and supports matched-pair merges,
transfers, and already-settled winning claims. Fresh wallet/network checks apply
there too. Unsettled claims still require the outcome source to settle first.

## Checks

```sh
pnpm --dir frontend typecheck
pnpm --dir frontend lint
pnpm --dir frontend test
pnpm --dir frontend test:coverage
pnpm --dir frontend build
```

Run the repository's `pnpm check` before release. Solidity/browser ABI checks,
differential math fixtures, chain-pinned read tests, production identity guards,
RPC/transaction failures, all eight local pools, and recovery flows are covered
by the repository gates. Production deployment still requires verification of
the real adapter, historical baseline, bytecode, and Arbitrum execution.

## Presentation and accessibility

The homepage uses a server-rendered editorial hero, eight-orbit graphic, live game
status, question board, mechanics, and funding explanation. No generated market
activity or decorative chart is presented as financial data. Reduced-motion
preferences disable animation and smooth scrolling; keyboard focus is visible.
FAQ, social metadata and generated `/llms.txt` documents describe the eight-market
mechanism and the actual configured launch state.

## Dependency maintenance

The October 2026 security refresh updates Next.js and its lint configuration to
16.3.8, sharp to 0.35.5, source-map-js to 1.2.2, and follow-redirects to 1.16.1.
Vite is declared explicitly at 8.1.6 so its automatically installed peer cannot
remain on the vulnerable 8.1.3 resolution. WalletConnect 2.26.0, the React Vite
plugin 6.1.2, and Vitest/coverage 4.1.12 resolve within their existing major ranges.
Other declared ranges were refreshed without forcing peer compatibility.

| Scoped override                                                       | Reason and verification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@next/eslint-plugin-next@16.3.8>fast-glob` → `npm:tinyglobby@0.2.17` | The pinned Next lint plugin requires fast-glob 3.3.1, which brings in unpatched braces 3.0.3 ([GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)). Newer stable and canary consumers still use that dependency. The inspected consumer makes only `globSync(pattern, { onlyDirectories: true })` calls. [tinyglobby](https://github.com/SuperchupuDev/tinyglobby) provides that API using fdir and picomatch, eliminating the vulnerable braces code rather than suppressing its advisory. `src/next-eslint-glob.test.ts` pins the consumer and replacement, guards the API surface, and exercises real plugin root discovery, ordinary nested patterns and the deep-nesting attack. All Next lint rules remain enabled. |

Review the override when upgrading the Next lint plugin. The version-scoped
selector and regression guard deliberately require another compatibility review;
there is no audit ignore, fake patched braces version, or relaxed lint rule.
