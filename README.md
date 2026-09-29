# Chaos Zero

[![CI](https://github.com/PredictionExplorer/ChaosZero/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/PredictionExplorer/ChaosZero/actions/workflows/ci.yml)
[![CodeQL](https://github.com/PredictionExplorer/ChaosZero/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/PredictionExplorer/ChaosZero/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/PredictionExplorer/ChaosZero/badge)](https://scorecard.dev/viewer/?uri=github.com/PredictionExplorer/ChaosZero)

**Chaos** is what you bet on; **zero** is what you have to trust. A perpetual
series of binary prediction markets on one question, asked fresh every
[Cosmic Signature](https://cosmicsignature.com) round:

> **Will this round end with more gestures (bids) than the previous round?**

Denominated in CST, resolved trustlessly from the Cosmic Signature game
contract on Arbitrum One, with open multi-LP liquidity in **one pool per
round whose trading fee is a liquidity-weighted vote by the LPs themselves**.
The whole series — every round, forever — is one dependency-free singleton
contract with no owner, no admin keys, and no upgradability:
[`src/GestureSeriesMarket.sol`](src/GestureSeriesMarket.sol).

A polished web app lives in [`frontend/`](frontend/README.md) (Next.js +
wagmi, deployable to Vercel): live YES-probability gauge and chart, the
count-vs-threshold race, one-click bets with exact client-side quotes,
liquidity provision with fee voting and earnings tracking, and round
navigation for resolving and claiming past rounds.

## How it works

- **Markets launch themselves — for the current round or ANY future round.**
  The first `addLiquidity` for a round initializes its market. No per-round
  deployments, no keepers, no configuration. Past rounds can never be
  initialized or traded — only exited.
- **Thresholds lock lazily.** A future round's threshold (the previous
  round's final gesture count) doesn't exist yet, so markets initialize
  without one; the first `addLiquidity`, bet or `resolve` that touches the
  round once the game has reached it snapshots the value (emitting
  `ThresholdLocked`). The value is public and final before any lock can
  happen, so lock timing is not a degree of freedom anyone can exploit —
  and the snapshot keeps decided-checks and resolution internally consistent
  forever after.
- **Two outcome tokens per round.** 1 CST mints a complete set of
  1 YES + 1 NO (`mintSets`), and a complete set always redeems for 1 CST
  (`redeemSets`), so the contract is fully collateralized by construction.
  YES pays 1 CST iff the final count is **strictly** greater than the
  threshold (a tie means NO wins); NO pays 1 CST otherwise.
- **One pool per round; the fee is an LP vote.** Liquidity lives in a single
  Uniswap-style constant-product pool (x·y=k) between YES and NO, whose
  implied probability is `reserveNo / (reserveYes + reserveNo)`. Every LP
  declares the fee they want when depositing (0–10%), and can re-declare
  anytime with `updateFeeDeclaration`; bettors pay the **share-weighted
  average** of all declarations:

  ```
  currentFeeBps = sum(shares_i x declaredFee_i) / totalShares
  ```

  Declarations set what bettors pay; fee **earnings** split pro rata by
  shares regardless of what each LP declared (a vote, not a private price).
  Fees accrue in CST and are claimable anytime (`claimFees`).
  - The **first LP** opens the pool at their chosen YES probability (the
    seeding returns the surplus side to them as outcome tokens) and their
    declaration is the opening fee.
  - Later LPs join at the pool's current ratio; excess tokens are credited
    back. Rounding always favors incumbent LPs. Removed shares stop voting.
- **Betting** (`betYes`/`betNo`) mints sets with your CST and swaps the
  unwanted side into the pool, so you hold only your side. To exit early, buy
  the opposite side and `redeemSets`.
- **Resolution** is permissionless. When the round ends (the game's round
  counter advances), `resolve(round)` compares the final count against the
  threshold. And because the gesture count is public and **only ever
  increases**, the instant it exceeds the threshold mid-round YES is already
  certain: betting and liquidity-adding halt atomically in that same block,
  and `resolve` fires early. Future rounds are never resolvable and never
  halt — nothing about them is provably certain before they start.
- **Round end freezes the market, never the exits.** Once the game's counter
  passes a round, betting, `addLiquidity` and `mintSets` all revert; LPs can
  ONLY withdraw. `removeLiquidity`, `claimFees` and `redeemSets` (until
  resolution) keep working forever.
- **Claiming**: after resolution `claim(round)` pays winning tokens 1:1.
  LP positions are never confiscated or swept: `removeLiquidity` works at ANY
  time — future, live, decided, or after resolution — paying pro-rata
  reserves plus accrued fees.

## Battle hardening

Each mitigation below is enforced by the contract and proven by a scripted
attack in [`test/GestureSeriesMarketHardening.t.sol`](test/GestureSeriesMarketHardening.t.sol):

- **LP pulls liquidity right before your bet** (front-run): every bet carries
  a mandatory `minTokensOut` floor computed from the quote you saw — worse
  execution reverts instead of filling. Same-class guards exist everywhere:
  `minSharesOut` on adds, `minYesOut`/`minNoOut` on removes. Verified on
  future-round pools too.
- **LP rug right AFTER your bet fills** (back-run): the fill already beat
  your floor, and pulling liquidity pays the LP only pro-rata pool inventory
  plus fees — it cannot touch set collateral. Your tokens stay backed 1:1,
  your claim pays in full, and you can always exit early by buying the
  opposite side (bets return at least their net input in tokens, even
  against a dust pool) and redeeming pairs. A fuzz property pins the
  strongest form: NO sequence of LP removes/re-adds/re-votes can change a
  filled bettor's balance or payout by one wei. What a rug does cost you is
  liquidity DEPTH until resolution — inherent to permissionless AMMs (a
  withdrawal lock would break the always-open exits above and wouldn't stop
  a patient rugger anyway); size positions accordingly.
- **Threshold-reveal sniping**: the moment the previous round ends, a future
  pool's price may be stale against the just-fixed threshold. The snapshot
  happens in-call, so the sniper trades against the LOCKED value at the
  pool's price and fee — informed flow against LP inventory (bounded by it,
  collateralization exact), never against bettors, never free. The
  degenerate case — previous round ends with zero gestures and the first
  gesture decides YES in the same block — refuses to trade at all.
- **Fee-jack sandwich**: a whale depositing a huge stake declared at the 10%
  cap right before your bet jacks the average fee — and fails exactly like a
  liquidity pull, because the higher fee pushes execution below your
  `minTokensOut` floor. The average can never exceed the 10% declaration cap.
- **Sandwiches and stale transactions**: slippage floors cap the damage at
  exactly your tolerance, and every price-sensitive call takes a `deadline`.
- **Betting on a decided outcome**: bets and adds check the live count
  against the threshold in the same call — there is no block in which
  certainty can be traded at stale prices. Round-over trading is blocked by
  the round counter, including for rounds whose whole life passed while
  funded as future markets.
- **First-depositor share inflation** (the ERC4626/Uniswap classic): minimum
  first deposit (0.001 CST), 1000 dead shares locked forever on every pool's
  first mint, zero-share mints revert, and all share math rounds against the
  depositor. The scripted attack recovers dust, not capital — against
  current-round and future-round pools alike.
- **Init front-running (price squatting)**: racing someone's pool-opening
  transaction turns theirs into a join at the squatter's ratio — but joins
  never move the price and credit all excess back, so the honest LP exits
  the roundtrip losing only rounding dust and the squatter extracts nothing.
- **JIT fee sniping**: a just-in-time LP inherits zero pre-join fees, skims at
  most its pro-rata slice of the single sniped bet, and exits holding
  inventory risk rather than free cash (bounded in tests; Arbitrum's FCFS
  ordering makes the game pointless in practice anyway).
- **Donations**: reserves and balances are internal accounting — direct CST
  transfers move no price, no share value, no payout.
- **Reentrancy**: a contract-wide guard plus strict checks-effects-interactions
  on every path (exercised with a malicious callback token).
- **Fee/solvency accounting**: bet fees live in an explicit per-pool escrow
  (`feeReserve`) with a MasterChef-style accumulator, so the invariant
  *contract CST = outstanding sets + fee escrows* holds **exactly, to the
  wei** — re-checked after every call of every invariant campaign.
- **No trust surface**: no owner, no pause, no upgrade path; rounding always
  favors the contract, so it can never owe more than it holds.

## Cosmic Signature integration

The market reads three getters from the game proxy
([`src/ICosmicSignatureGame.sol`](src/ICosmicSignatureGame.sol)):

| Getter | Used for |
|---|---|
| `roundNum()` | round liveness/rollover; init + resolution gating |
| `bidderAddresses(round)` | gesture counts: threshold (round−1) and outcome (round) |
| `token()` | the CST token address |

Arbitrum One addresses:

- Game proxy: `0x6a714Ae7B5b6eA520F6BCA23d2E609C4Fd5863F2`
- CST token: `0xAD91843e6A58Ba560F577E676986AFb1dba6FBA0`

## Development and testing

```bash
git clone --recurse-submodules https://github.com/PredictionExplorer/ChaosZero
cd ChaosZero
make setup    # submodules, frontend deps, git hooks, then a toolchain check
make check    # every offline CI gate: format, lint, build, tests, coverage,
              # differential vectors, gas snapshot
make help     # everything else: test-fork, test-e2e, test-heavy, analyze, ...
```

Needs git, Node 22 with pnpm (`corepack enable pnpm`) and
[Foundry](https://getfoundry.sh) at the version pinned in
[`tools/versions.env`](tools/versions.env) (`make foundry` installs it);
`make doctor` checks all of it. A dev container with everything preinstalled
lives in [`.devcontainer/`](.devcontainer/devcontainer.json).
[CONTRIBUTING.md](CONTRIBUTING.md) covers the rest: the git hooks, every test
layer, CI, gas snapshots and vectors, pinned tool versions, and the rule that
`src/` is deployed and never changes without a redeploy.

The core contract suites, plus the differential bridge to the frontend
(CONTRIBUTING.md lists every layer, including gas benchmarks, deployment
integrity, symbolic, mutation and end-to-end tests):

- [`test/GestureSeriesMarket.t.sol`](test/GestureSeriesMarket.t.sol) — unit
  tests for every function: lazy initialization, tie semantics, early
  resolution, exact weighted-fee-vote math (opening, joining, re-voting,
  removing), LP share/fee exactness, every guard; the round-end
  withdraw-only matrix (ended-unresolved full exits, claim → remove → claim
  ordering); and the future-round lifecycle (funding/trading before the
  round exists, threshold locking via every entry point and however late,
  far-future in-kind exits, multi-round concurrency and isolation).
- [`test/GestureSeriesMarketFuzz.t.sol`](test/GestureSeriesMarketFuzz.t.sol) —
  property-based fuzz tests. Each states an economic/safety property that must
  hold for all inputs: CST conservation across the whole lifecycle (including
  the future → current → past phase walk), x·y=k monotonicity, quotes equal
  execution (at any fee vote), path independence, LP joins can't extract
  value from incumbents, add-then-remove never profits, the fee-vote ledger
  always equals the naive per-holder sum, the average is bounded by its
  voters' declarations and monotone in every vote, fee escrow exact to the
  wei under changing votes, the resolution truth table matches strict
  comparison for all counts and phases, the locked threshold always equals
  the previous round's final count regardless of touch timing, and no
  sequence of LP actions can change a filled bettor's balance or payout.
- [`test/GestureSeriesMarketInvariant.t.sol`](test/GestureSeriesMarketInvariant.t.sol)
  — stateful invariant testing with `fail_on_revert`. A handler drives random
  interleavings of the full multi-round lifecycle (LPs in and out of current
  AND future rounds, fee re-votes, bets, sets, gesture arrivals, threshold
  crossings and reveals, round rollovers, early/normal resolutions, claims)
  while ghost variables track every wei. After every call: exact
  collateralization, coherent share ledgers, an exact fee-vote ledger, fee
  solvency — plus two lifecycle laws: a threshold never changes once
  knowable, and a past round's pool/escrow/supply only ever shrinks. After
  every campaign: force-drain everything (advancing the game past all funded
  future rounds) and prove everyone is paid in full, with the retained
  remainder equal to dead-share reserves plus fee dust — exactly.
- [`test/GestureSeriesMarketHardening.t.sol`](test/GestureSeriesMarketHardening.t.sol)
  — the attack suite described above, one scripted adversary per mitigation:
  rug-after-bet, pulls and sandwiches (current and future pools), fee jacks,
  JIT, inflation, reveal sniping, instant-decision reveals, betting on
  published results, squatting, reentrancy, donations, griefing.
- [`script/GenerateVectors.s.sol`](script/GenerateVectors.s.sol) — executes
  hundreds of real contract flows and dumps them to
  `frontend/src/test/fixtures/contract-vectors.json`; the frontend's math
  library must match **bit-for-bit** (CI regenerates and fails on drift).

Fuzzing intensity is configured per profile in [`foundry.toml`](foundry.toml):
`make test-heavy` runs the `heavy` campaign (50k fuzz runs, 512x256 invariant
campaigns); crank its numbers up arbitrarily for overnight runs. Fork tests
validate against the live game:
`ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc make test-fork`.

## Deployment

Deploy the singleton **once**; every future round runs on it automatically.
The deployer key lives in an encrypted Foundry keystore — never in a file or
shell variable:

```bash
# one-time: import the deployer key into an encrypted keystore
cast wallet import pm-deployer --interactive

forge script script/Deploy.s.sol \
  --rpc-url $ARBITRUM_RPC_URL --account pm-deployer --broadcast \
  --verify --etherscan-api-key $ETHERSCAN_API_KEY
```

No pre-funding, no parameters, no admin — liquidity arrives permissionlessly
per round, from anyone, each LP voting the fee they want.

For frontend development there is a local sandbox
([`script/DeployLocal.s.sol`](script/DeployLocal.s.sol)) that deploys a mock
game + mock CST + the series with seeded liquidity on anvil; see
[`frontend/README.md`](frontend/README.md).

## Design notes and trade-offs

- **Live information is priced in, by design.** The gesture count is public
  while the round runs, so this is a live over/under against last round's
  count. Certainty accumulates monotonically — and asymmetrically: YES can
  become certain mid-round (handled by early resolution + the atomic trading
  halt), NO can't before the round ends. Late informed trading costs LPs
  money; the per-bet fee is the compensation, and LPs both pick that fee and
  can leave at any moment. Size positions accordingly.
- **Future rounds extend that property one event earlier.** While round N is
  still in the future, round N−1's growing count is the future threshold,
  public in real time; when N−1 ends the threshold reveal is a discrete
  repricing event that arbitrageurs will trade against the pool. LPs who
  provide across the reveal opt into that risk. Whoever legitimately ends
  round N−1 (the game's prize claimant) picks the reveal block and can
  bundle a bet — same informed-flow class, fee-compensated, floor-protected
  for everyone else.
- **Future rounds are uncapped, isolated, and always exitable in kind.**
  Every round's market is fully collateralized and independent; LPs and
  paired holders can always exit (`removeLiquidity` + `redeemSets`) even if
  the round never arrives. One-sided positions on far-future rounds need the
  round to actually end before `claim` — that liquidity-depth/time risk is
  the bettor's to size.
- **Outcome manipulation is possible but costly.** Someone holding YES could
  place extra gestures to push the count over the threshold — and, in the
  cross-round direction, someone holding round-N NO could gesture in round
  N−1 to raise round N's bar. Each gesture costs real ETH/CST in the game,
  so modest pool sizes keep manipulation unprofitable in every direction.
- **The fee vote is majority-by-capital, on purpose.** Your declaration is a
  vote weighted by your shares, not a guaranteed private price: a bigger LP
  can move the average against you. The trade-offs that make this acceptable:
  the average is hard-capped at 10%, every declaration is public, re-voting
  is one cheap transaction, exit is instant and always open — and bettors are
  insulated from vote swings by their slippage floors. (The alternatives —
  per-LP fee tiers or an order book — fragment liquidity or add heavy
  infrastructure; see the git history for the tiered design.)
- **The game is an owner-upgradeable proxy.** The market trusts its
  `roundNum` and `bidderAddresses` getters.
- **Dead-share dust is the cost of inflation resistance.** Each pool
  permanently locks 1000 share-wei plus the CST backing them (wei-scale);
  in exchange, first-depositor inflation attacks are structurally dead.
