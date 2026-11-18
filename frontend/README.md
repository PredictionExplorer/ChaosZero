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
Anvil wallets, faucet, simulator gestures, cycle closure and clock controls are enabled only on chain **31337**. No real wallet key is
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
| `NEXT_PUBLIC_INDEPENDENT_MARKET_ADDRESS` | Original eight-question market. Keep this address for old positions.           |
| `NEXT_PUBLIC_GAME_FUNDED_MARKET_ADDRESS` | Verified V4 successor. Set only after the game has configured and funded it.   |
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

After V4 cutover the homepage follows the game-funded market. The `/previous?round=N` route uses the original independent market for its positions, merges and claims. CST sent directly to the successor stays outside its pools. The first trade, complete-set split or optional sync applies the game grant and any carry.

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
1 CST. In V3, wallets can make irreversible pool contributions. The V4 successor accepts only game funding and issues no LP shares, fees or repayment. Both markets allocate new funds equally across their eight pools. Unpaid claims remain
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

Use the frontend lockfile, `pnpm-workspace.yaml`, `patches/` and `tooling/glob/` together when installing. The frontend production and development dependency graphs were audited with `pnpm audit --prod` and `pnpm audit`. Both reported zero findings on 18 November 2026.

- Next.js and its lint configuration are pinned to 16.4.6. The Next lint plugin's directory enumeration uses tinyglobby's `globSync`. Its version and call sites are checked in `src/next-eslint-glob.test.ts`.
- WalletConnect retains its original filesystem and browser-compatible storage format. Its filesystem filter runs the patched Minimatch engine. Reown's frame messages and the Coinbase CDP policy schemas use native Zod 4.6.7. Scoped patches preserve optional fields, ABI and EIP-712 field types, and both Coinbase module formats. The Base connector uses browser-buildable CDP 1.51.2 with Axios 1.21.1. The wallet schema and storage compatibility tests resolve the installed packages through the real connector.
- The development tools use the private `@chaos-zero/tooling-glob` module because picomatch has no released fix for [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf). It implements the file filters and path scanning used by Vite, Vitest, tinyglobby, and fdir with Minimatch 11.0.9. The fdir patch identifies this matcher explicitly in both module formats. The Vite patch passes its custom asset patterns directly to Rolldown's native filter, as its load hook already does. The compatibility suite exercises discovery, coverage exclusions, asset loading, and the Next directory lookup. No upstream vulnerable parser is included through these dependencies.

When upgrading the affected consumers, remove the corresponding patch or override once their stock dependencies pass the same audits, compatibility tests, production build, coverage checks and local market rehearsal.
