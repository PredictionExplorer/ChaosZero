# Chaos Zero — frontend

## Independent local prototype

`pnpm dev:local` from the repository root now launches `IndependentOutcomeMarket`
on disposable Anvil with the local game and test CST. Open `/shared` (or `/`).
`NEXT_PUBLIC_INDEPENDENT_MARKET_ADDRESS` selects the new ABI explicitly; it never
inherits either older market address. The launcher sets the new address and
blanks `NEXT_PUBLIC_SHARED_MARKET_ADDRESS` and `NEXT_PUBLIC_MARKET_ADDRESS`.

Each question has its own collateral and weighted binary price. A `fundRound`
gift enters all eight pools at once. CST sent directly to the market, and carry
when a cycle starts, enter at the next buy, sell or `fundRound` on an open cycle
(see the root README). `fundingPreview(cycle, 0)` reports exactly what the next
trade absorbs. When its `canFund` is set, quotes, card prices and payouts use the
effective pools after that absorption (on an unstarted cycle, its allocations
with `seedPreview` seeds), and the allocations are part of the quote cache key.
The preview reports exact allocations, including integer remainders and anything
deferred by capacity limits. Starting odds use the previous cycle’s
40–60% **time window**; missing coverage uses the prior seed. If the immediately
preceding game cycle has no initialized market, the fallback is 50%. This is
recorded-price history, not an external price oracle.

Trading continues until full game closure even when a comparison is already
clear. Settlement moves normal 1:1 winning claims into a separate immutable vault,
zeros closed-cycle trading collateral, and carries all remaining funds forward.
An unstarted cycle that can start is tradeable: its first trade settles the prior
funded cycle, opens the pools from carry and held contributions, and costs a
higher network fee, which the trade panel states. Later claims from an old cycle
use its reserve and never reduce new-cycle pool balances.

The funding panel adds new CST to all eight pools, or calls `fundRound(cycle, 0)`
to open the pools or distribute held CST without trading. That trigger is
enabled only when `canFund` is set; otherwise it says why, for example that
under 1 CST waits until a gift sweeps it. The panel shows the market address for
direct CST-only transfers, which are irrevocable gifts. The dashboard separates
carried CST from held contributions. The 1 CST threshold (`MIN_AUTO_TOP_UP`) has
no on-chain getter; a test pins the frontend copy to the Solidity-generated
`src/test/fixtures/independent-contract-vectors.json`.

The UI includes buys/sells, fixed-rate complete sets, batch merges, owner transfers,
and local wallet/game controls, including a local-chain-only direct transfer of
100 test CST to the market. Source errors disable trading, splitting and
funding; fresh source-independent balances still permit merges/transfers, and
cached settled claims remain retrievable. Every write pins its account and local
chain. Public-chain writes remain disabled pending a verified live source.

New implementation: `src/independent/`, using the independently verified weighted
solver in `src/shared/independent-math.ts`. Browser coverage in
`e2e/independent-market.spec.ts` exercises three cycles, price isolation, exact
funding, history inheritance, source outages, protected late claims, carry, a
cycle started by its first buy, and a direct transfer absorbed by the next buy.
Every browser run snapshots/restores Anvil for retry isolation.

## Previous shared prototype (regression implementation)

The older joint-pool modules and their tests remain in `src/shared/`. To inspect
that UI with an explicit compatible old deployment, unset the independent address
and configure `NEXT_PUBLIC_SHARED_MARKET_ADDRESS`. The default launcher no longer
deploys this earlier design. The following section documents that retained implementation.

The previous simulator deployment used a joint market backed by one pool per cycle.
Its explicit-address UI remains available at `/shared` for regression work.

The eight recurring questions share one pool per cycle. The screen supports
exact buy/sell quotes, explicit CST approvals, irreversible pool gifts, partial
settlement and retrieval, completed-cycle navigation, and sponsor-residue
rollover. Local controls provide test CST, ETH/CST gestures, time advances, and
cycle closure. Connect **Mock Connector 1**, **2**, or **3** to use separate unlocked local accounts.
The local wallet and public reads both use `NEXT_PUBLIC_RPC_URL`.

`NEXT_PUBLIC_SHARED_MARKET_ADDRESS` explicitly selects the older shared contract. When
present, `/` displays the shared screen as well. It never falls back to
`NEXT_PUBLIC_MARKET_ADDRESS` or applies the shared ABI to that legacy address.
Both the shared screen and its transaction actions reject chains other than 31337. A verified live outcome-source integration is required before this
prototype can trade on a public chain.

YES and NO positions are standard ERC-1155 tokens. The complete-set panel splits
1 CST into one YES plus one NO for the same question, and merges matched units
back into CST at exactly 1:1. Splits work before pool sponsorship; merges work
after settlement too. Batch merge pairs each question independently. Portfolio
transfers send owner-held tokens directly to another wallet or an ERC-1155 receiver.
The UI displays total CST custody, maximum payout obligations, and minimum
remaining reserve separately: splitting a pair increases custody but does not
add AMM liquidity or change prices.

If outcome reads fail, trading, splitting and sponsorship remain disabled. A
narrow recovery panel refreshes only the market/token balances for an explicit
or previously loaded cycle and allows owner merges/transfers. It does not guess
the current cycle or reuse stale balances; polling preserves drafts while
transaction controls wait for fresh data. Wallet, market and cycle changes reset
those drafts. Transactions pin both the connected account and local chain.

The implementation lives in `src/shared/`. The BigInt quote solver mirrors the
contract's directed-rounding logarithm bounds and checks all feasible joint
outcomes. Quotes are recomputed when their economic basis changes; a stale
exact quote can revert rather than accepting worse output. The frontend shows
no invented chain values. Unit, component, and property tests include
Solidity-generated differential vectors in
`src/test/fixtures/shared-contract-vectors.json`. The default `pnpm test:e2e`
run exercises the independent deployment and skips the retained shared browser
spec, which requires a compatible older deployment.

A gift supplies capacity without creating LP shares, fee income, or withdrawal
rights. It is separate from buying a YES/NO position. The local simulator uses
shortened durations and test tokens; it is not the deployed Cosmic Signature game.

## Existing deployed market

A Next.js app for the [Chaos Zero series](../LEGACY_MARKET.md): one binary
prediction market per Cosmic Signature round — _will this round end with more
gestures than the last one?_ — settled in CST on Arbitrum One.

Everything lives on one screen, per round: the live YES probability with its
history, the count-vs-threshold race, one-click YES/NO bets with exact
client-side quotes at the pool's LP-voted fee, a full liquidity panel (vote
your fee, open the pool at your odds, re-vote anytime, track and claim fee
earnings), your position with mark-to-market value, one-click resolution
(including early resolution when the threshold is crossed), claiming, and
navigation across past rounds.

Everything explanatory — the intro hero, how-it-works, footer, and the whole
FAQ (answers included) — is server-rendered static HTML, so search engines
and AI crawlers read the full story without executing JavaScript. SEO ships
complete: Open Graph / Twitter cards generated at build time, canonical URLs,
`robots.txt`, `sitemap.xml`, a web app manifest, JSON-LD (`WebSite`,
`WebApplication`, and a full `FAQPage`), and `/llms.txt` for AI agents. The
FAQ page carries no wallet code at all, and the wallet modal (plus motion's
animation engine) loads on demand rather than in the first-load bundle.

## Stack

- [Next.js 16](https://nextjs.org) (App Router, Turbopack) + React 19 + TypeScript (strict)
- [Tailwind CSS v4](https://tailwindcss.com) with a custom "void + signal" design system
- [wagmi v3](https://wagmi.sh) + [viem](https://viem.sh) for wallets and contract I/O
  (injected wallets are auto-discovered via EIP-6963; WalletConnect optional)
- [TanStack Query](https://tanstack.com/query) for on-chain data caching/refresh
- [Vitest](https://vitest.dev) + Testing Library + [fast-check](https://fast-check.dev)
  property tests, plus **differential tests against vectors executed by the
  real contract**
- [motion](https://motion.dev) for tasteful animation, [sonner](https://sonner.emilkowal.ski) for tx toasts

## Architecture

```
src/
  lib/          pure, framework-free logic (fully unit-tested)
    math.ts       exact bigint mirror of GestureSeriesMarket.sol: quotes at
                  the weighted fee, fee-vote previews, pool opening/joining/
                  removing previews, fee accumulator, payouts, slippage —
                  validated property-by-property AND bit-for-bit against
                  vectors generated by the contract itself
    history.ts    event-sourced replay: reconstructs the pool and the
                  probability chart from logs alone (Bet events carry netIn,
                  so replay stays exact under the time-varying voted fee)
    market.ts     round snapshot types, lifecycle phases (live / decided /
                  ended / resolved), position & LP valuation
    config.ts     env parsing/validation, ?market= and ?round= overrides
    format.ts     display formatting + strict amount parsing
    errors.ts     every contract error mapped to a human explanation
    wagmi.ts      chain + connector config
    abi/          contract ABIs (generated by forge, checked in)
  hooks/        thin wagmi/react-query glue
    use-market.ts         series statics + the followed round's full snapshot
                          (state, the pool, user balances & LP position)
    use-market-events.ts  per-round event scan + live watcher for chart & feed
    use-market-actions.ts approve/bet/addLiquidity/removeLiquidity/
                          updateFeeDeclaration/claimFees/mint/redeem/resolve/
                          claim with a uniform submit→confirm→refresh toast
                          flow and tx deadlines
  components/   presentational components (props in, callbacks out)
```

The design rule: **all market math happens in `lib/` with bigints, identically
to the contract** (floor/ceil rounding included). Components never compute
prices themselves — they render what the lib computes, and the lib is what the
tests hammer. Quotes are instant and RPC-free; the slippage guard
(`minTokensOut`) submitted with each bet comes from the same math at submit
time. It caps the output deterioration the caller accepts; it does not prevent
sandwiching or other adverse execution within that limit.

## Develop

Run these commands from `frontend/`; the full local-system launcher above runs
from the repository root.

```bash
pnpm install
pnpm dev             # http://localhost:3000

pnpm test            # vitest run (unit + property + differential + component)
pnpm test:watch
pnpm test:coverage
pnpm lint
pnpm typecheck
pnpm build           # production build
```

### Local sandbox (no real funds)

Run a disposable series against [anvil](https://getfoundry.sh) with mock CST
and a mock game you control:

```bash
# terminal 1 — local chain
anvil

# terminal 2 — deploy mock CST + game + series, seed the pool
forge script script/DeployLocal.s.sol --rpc-url http://127.0.0.1:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --broadcast
```

Then point the frontend at it in `frontend/.env.local` (the series address is
printed by the script):

```bash
NEXT_PUBLIC_CHAIN_ID=31337
NEXT_PUBLIC_MARKET_ADDRESS=<GestureSeriesMarket address from the script>
NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545
```

On the anvil chain the wallet modal offers three **Mock Connector** choices for anvil's
unlocked default accounts — no browser extension needed. Drive the game from
the command line:

```bash
GAME=<MockGame address from the script>
# more gestures come in (round 3 in the sandbox)
cast send $GAME "setNumBids(uint256,uint256)" 3 790 --private-key $PK --rpc-url http://127.0.0.1:8545
# cross the threshold (800): trading halts, early YES resolution unlocks
cast send $GAME "setNumBids(uint256,uint256)" 3 801 --private-key $PK --rpc-url http://127.0.0.1:8545
# or end the round (unlocks normal resolution)
cast send $GAME "setRoundNum(uint256)" 4 --private-key $PK --rpc-url http://127.0.0.1:8545
```

## Configuration

All config is env-driven and validated at startup (`src/lib/config.ts`):

| Variable                               | Required           | Purpose                                                                                         |
| -------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_CHAIN_ID`                 | no (default 42161) | 42161 Arbitrum One, 31337 anvil                                                                 |
| `NEXT_PUBLIC_MARKET_ADDRESS`           | no                 | the GestureSeriesMarket singleton; `?market=0x…` overrides                                      |
| `NEXT_PUBLIC_RPC_URL`                  | no                 | custom RPC (falls back to the chain's public one)                                               |
| `NEXT_PUBLIC_DEPLOY_BLOCK`             | no                 | series deploy block — speeds up event scans                                                     |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | no                 | enables WalletConnect for mobile wallets                                                        |
| `NEXT_PUBLIC_SITE_URL`                 | no                 | canonical origin for SEO metadata, sitemap and social cards (defaults to the production domain) |
| `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` | no                 | Google Search Console ownership token (emits the verification meta tag)                         |
| `NEXT_PUBLIC_BING_SITE_VERIFICATION`   | no                 | Bing Webmaster ownership token (`msvalidate.01` meta tag)                                       |

One deployment serves **every** round forever: the app follows the game's
current round live, and `?round=N` links to any past round (for claims and
history).

## Deploy to Vercel

1. Import the repository in Vercel and set **Root Directory** to `frontend`
   (framework preset: Next.js — auto-detected).
2. The chain id, market address and deploy block ship with the repo in
   [`.env.production`](.env.production) (public on-chain facts; a push
   rebuilds the site pointing at the committed contract). In the Vercel
   dashboard add only the two service variables:
   `NEXT_PUBLIC_RPC_URL` (dedicated Arbitrum RPC — the public fallback is
   rate-limited) and `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` (optional, for
   mobile wallets). Dashboard values override the file.
3. Ship. There is nothing to update per round, ever.

## Testing philosophy

- `lib/math` carries the same economic properties the Solidity fuzz suite
  enforces (pool never loses, quotes equal execution at any fee vote, the
  vote ledger is exact and monotone, LP joins can't extract value, fee
  conservation). A quote is validated against the sampled state; later state
  changes can alter execution within the user's slippage limit or cause a revert.
- On top of the properties, `src/test/fixtures/contract-vectors.json` holds
  hundreds of flows **executed by the actual contract** (via
  `script/GenerateVectors.s.sol`); the TS math must reproduce every reserve,
  share and fee number bit-for-bit. CI regenerates the vectors from the
  contracts and fails on any drift, so the two implementations cannot diverge
  silently.
- `lib/history` is verified by roundtrip: simulate random LP/bet sequences,
  emit the events the contract would, replay them, and require the exact
  end-state pools back.
- Components are tested through user behavior (typing, clicking, sliding)
  with Testing Library — fee-vote selection and re-voting with live average
  previews, LP flows including first-LP odds selection, validation, approval
  routing, slippage floors, and every lifecycle phase including
  decided-but-unresolved.
