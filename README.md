# Chaos Zero

Eight recurring YES/NO questions about Cosmic Signature V3 on Arbitrum One. Every
question has its own CST-backed automated market maker, and every new cycle opens
at **50% YES / 50% NO**. Previous prices and historical game timestamps do not
influence the opening odds.

The contracts are deployed on Arbitrum One, and this checkout's production frontend
configuration points to the verified eight-question market. **The frontend has
not been published as part of this connection step.** The local simulator remains
separate and uses disposable funds.

- Market: `0x2BC4759A2b44e1197EAdc4E035Eb8c52299658d2`
- V3 outcome source: `0x099c29624E05506582655417344A17FB71c9d138`
- Payout vault: `0x60F79aF7378Dc06F7747827446b32157c796dd3e`
- Read helper: `0x5E286886fD4073D9ab63829081608aAfB610fD06`

## The eight questions

| ID  | Question                                 | Resolution                                                                                 |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| 0   | More gestures than the previous cycle?   | Final total of ETH and CST gestures is greater.                                            |
| 1   | Longer Endurance Champion duration?      | Final longest uninterrupted duration is greater.                                           |
| 2   | Longer Chrono Warrior duration?          | Final longest tenure of an Endurance record is greater.                                    |
| 3   | More ETH spent on gestures?              | Actual ETH gesture charges are greater, excluding separate contributions and refunded ETH. |
| 4   | More CST burned through gestures?        | Gross CST gesture charges are greater, before any CST reward offsets.                      |
| 5   | Odd final gesture count?                 | An odd total resolves YES; an even total resolves NO.                                      |
| 6   | Same gesture earns Endurance and Chrono? | The same individual gesture earns both titles. Matching wallets alone is insufficient.     |
| 7   | Higher maximum CST payment?              | The largest actual CST payment for one gesture is greater.                                 |

Strict-comparison ties resolve NO. The game continues to determine its own cycle
boundaries. Trading, splitting and funding remain available until the actual
round-ending transaction advances `roundNum`, even when an answer is already
known. An elapsed countdown does not finalize a market. All eight settle together
after closure.

## Production game and launch baseline

The production game proxy is `0x6a714Ae7B5b6eA520F6BCA23d2E609C4Fd5863F2` and CST
is `0xAD91843e6A58Ba560F577E676986AFb1dba6FBA0` on chain **42161**. The V3
implementation inspected for this release is
`0xc1b97E1b0baC86248653B18706dbC5c8898c5c06`.

`V3OutcomeSource` reads all eight results from the game's permanent `roundStats`
and uses `tryGetCurrentChampions` for live durations. It resolves the dual-title
question from the game's individual-gesture flag. No historical timestamp getter,
price oracle, administrator result submission or keeper is required for the
normal V3 cycle flow.

Round 3's predecessor completed under V2 and lacks five comparative values in
those new getters. The launch adapter freezes the reconstructed round 2
baseline at construction; subsequent cycles compare native V3 records. The
[published evidence](deployment/arbitrum-round-2-baseline.json) cross-checks 1,257
gestures, 1,253 block headers, 1,258 transaction receipts and 13 wallets. Reproduce
it with `pnpm verify:baseline` (`--refresh` fetches fresh evidence; `--offline`
rechecks previously downloaded evidence). This explicitly accepted one-time input
is **not an on-chain historical proof verifier**. See [the integration notes](GAME_STORAGE_REQUIREMENTS.md) and
[deployment procedure](DEPLOYMENT.md).

## Equal AMM funding

`fundRound(cycle, amount)` contributes existing CST to all eight pools. Every
amount is divided equally; indivisible base-unit remainders go to the lowest
question IDs, with at most one base unit of difference. The market cannot mint
CST. Contributions are irreversible: **no LP shares, trading fees, refunds or
sponsor withdrawal rights** are created.

CST transferred directly to the market is also a contribution. A transfer cannot
execute market code, so the next eligible buy, sell or funding call absorbs it
before pricing. During an already funded cycle, implicit absorption waits until
at least **1 CST** is held. Smaller amounts wait for more, any explicit gift, or
the next cycle's opening. Splits, merges, claims, settlement and position transfers
do not absorb held funding.

Each question maintains separate collateral and YES/NO liabilities. Its trades
cannot spend another question's backing. A transaction may first distribute held
funding to all eight questions, then price its selected question against the
updated pool.

At settlement, every outstanding winning unit is reserved in
`OutcomeSettlementVault` and pays exactly one CST. Remaining collateral becomes
carry for a subsequent cycle, divided equally among its eight pools. Old claims
have no expiry and cannot become new-cycle liquidity. The first funding or trading
call of a new cycle settles the last funded cycle before opening the new pools.

## Pricing and positions

The AMM uses reserves `C - YES supply` and `C - NO supply` with equal fixed
weights. New pools always start at 50/50, regardless of previous trading. Exact
trade amounts are checked with rigorously enclosed integer logarithms; the
frontend quotes with BigInt. See [the numerical arguments](src/libraries/LOG_BOUNDS.md).

One CST splits into one YES and one NO unit for the same question and cycle. A
matching pair merges back into one CST without changing the AMM reserves. Splits
do not by themselves fund trading liquidity. Pairs from different questions or
cycles cannot be merged. Source-independent pair merging remains available after
closure; settled winning claims also no longer require the adapter.

Positions are ERC-1155 tokens. Their current holder receives sale, merge or claim
proceeds. An operator approval authorizes transfers of all an owner's position
types until revoked; the interface's direct transfers do not require such an
approval. The token ID is `(cycle << 4) | (question << 1) | side`, with YES=1,
NO=0 and 18-decimal amounts.

Quotes have exact input/output amounts and an expiry. A changed pool can make a
quote revert but cannot cause that transaction to fill worse. Network fees still
apply. Additional funding can move a pool toward 50/50. Tiny trades can be
unquotable due to integer bounds; each question's collateral is capped at `2^120`
base units. Exact-transfer, non-rebasing collateral is required.

## Run locally

Use Node 22.23.2 or supported Node 24, pnpm 10.32.0 and Foundry 1.7.1.

```sh
pnpm setup:dev
pnpm dev:local
```

Open <http://127.0.0.1:3000/>. The launcher creates a fresh, disposable Anvil chain,
local CST and game simulator, and an independent market funded with 10,000 test
CST. It requires no private key. Local controls can obtain test CST, place gestures,
advance time and close cycles. Those controls are unavailable on Arbitrum.

Override local ports with `PORT=3100 ANVIL_PORT=8555 pnpm dev:local`. The launcher
refuses occupied ports. `pnpm local:smoke` checks the actual browser quote solver
against the running contracts and restores its starting chain snapshot.

For the production prelaunch homepage without a local chain:

```sh
pnpm --dir frontend dev
```

See [frontend configuration](frontend/README.md). The verified market/source
addresses are configured for production builds. All contract addresses are public configuration;
private keys and explorer API keys never belong in frontend environment variables.

## Deploy later

[DEPLOYMENT.md](DEPLOYMENT.md) documents the interactive Hardhat commands for
Arbitrum deployment and automatic Arbiscan verification. They prompt in a hidden
terminal for credentials, keep them in memory, suppress sensitive diagnostics,
and persist only public deployment receipts. A separate verification command
requires no signing key. Running tests never broadcasts to Arbitrum.

## Verification

```sh
pnpm check             # full repository gate
pnpm check:contracts   # compiler, size, unit/fuzz/invariant suites
pnpm check:frontend    # lint, types, coverage, build, dependency audit
pnpm check:vectors     # Solidity/browser differential fixtures and math oracle
pnpm test:deployment   # hidden prompts, secret handling, local deploy/resume/verify
pnpm test:baseline     # historical replay, strict ties and evidence validation
pnpm test:e2e          # disposable local chain and real browser lifecycle
pnpm test:heavy        # 50,000 fuzz inputs per property; 512 x 256 invariant campaigns
```

The repository includes adversarial accounting, transfer, source, pricing and
recovery tests. [VALIDATION.md](VALIDATION.md) records completed runs and their
limits. Passing tests cannot guarantee absence of bugs or replace an independent
security audit. [SECURITY.md](SECURITY.md) describes the trust boundary and economic
limitations. [CONTRIBUTING.md](CONTRIBUTING.md) describes gates and reproducibility.
