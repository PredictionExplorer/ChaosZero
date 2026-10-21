# Production V3 preparation — 21 October 2026

This release candidate changes only ChaosZero. No public contract or frontend
was deployed, no user signing/API credentials were requested, and no Cosmic
Signature repository was modified. The new market/source frontend addresses stay
blank until the operator deploys and verifies the new contracts.

## Completed checks

| Check                       | Result                                                                                                                                                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Complete repository gate    | `pnpm check` passed after dependency remediation: formatting, tooling, Hardhat deployment tests, Solidity build/sizes/tests, compiler parity, differential fixtures, mathematical oracle, frontend lint/types/coverage/build, browser flows and audits.                  |
| Solidity default suite      | 265 passed, zero failed; one optional live-fork setup skipped when no RPC is configured.                                                                                                                                                                                 |
| Extended fuzz campaign      | 58 properties × 50,000 inputs = **2,900,000 generated cases**, zero failures.                                                                                                                                                                                            |
| Extended stateful campaigns | Eight invariant properties × 512 campaigns × 256 actions = **1,048,576 calls**, zero handler reverts or invariant failures. This includes retained legacy tests and the independent-market ledger.                                                                       |
| Actual V3 fork integration  | Two tests passed at Arbitrum block **516865668**, including actual V3 gestures, cycle closure, native results, eight-way funding, settlement, rollover and old winning claims.                                                                                           |
| Frontend                    | **1,385 tests across 58 files**, with all coverage thresholds unchanged; lint, TypeScript and Next.js 16.3.8 production build passed.                                                                                                                                    |
| Browser                     | Three Chromium tests passed: full trading/transfer/merge/funding/settlement/rollover lifecycle and desktop/mobile/accessibility navigation. Widths 1440, 390 and 320 have no horizontal overflow or clipped controls.                                                    |
| Deployment tooling          | 17 tests passed: hidden real-PTY input, safe diagnostics, public-only durable journals, gas reservation validation, implementation pinning, interrupted deployment, verification without a signer and a complete disposable local deployment.                            |
| Historical baseline         | Nine regression tests passed. Reconstructed **1,257 gestures** from **1,285 events**, **1,253 independently retrieved headers**, **1,258 successful independent-provider receipts**, and **13 wallets'** permanent statistics. No game upgrades occurred during round 2. |
| Compiler parity             | All four Hardhat deployment runtimes exactly match Foundry-tested executable bytes, excluding validated CBOR metadata. Three regression tests reject executable changes and malformed metadata.                                                                          |
| Numerical fixtures          | All three generated fixture sets reproduced exactly. Ten oracle regression tests and 631 Solidity logarithm intervals passed independent 170-digit Decimal verification.                                                                                                 |
| Dependency audits           | Root and frontend audits report **zero known vulnerabilities**. All production severities are checked. No advisory was ignored and no lint rule was disabled.                                                                                                            |

The heavy campaign took 828.68 seconds with seed:

```sh
FOUNDRY_FUZZ_SEED=0x9c632d7ac054a1a2d0b1ab4c7bdc3d77f0fdfc302cf8d39be862bb41ec9e720a pnpm test:heavy
```

The opt-in fork run is reproduced with:

```sh
CHAOSZERO_V3_FORK_RPC_URL=https://arbitrum.drpc.org forge test --match-contract V3OutcomeSourceForkTest -vv
```

Foundry does not implement ArbOS entropy precompiles. The fork test substitutes
four entropy reads (`arbBlockNumber`, `arbBlockHash`, `getGasBacklog`,
`getL1PricingUnitsSinceUpdate`) while executing the real game, token, adapter,
market and payout code. Local test balances use `deal`. This is not a public
transaction or a full native ArbOS execution claim.

## Pre-deployment recheck and immediate claims

A further review on 21 October reproduced the historical values without changing
any baseline data or commitments. Fresh reads matched all 1,285 event records,
all 13 wallet records and the no-upgrade result. Eight selected receipts and
headers were refreshed independently, including the first/closing transactions,
maximum CST payment and both champion episodes. All 644 CST gesture receipts
contain the matching gross CST burn. Independent direct state-machine and
record-episode replays agree on both durations and on the distinct winning
gesture IDs despite identical recipient wallets.

The live deployment preflight, all 17 deployment-secret/recovery tests, dependency
audits and compiler parity checks passed again. This review found no additional
confirmed contract or credential-handling defect. The recovery instructions now
explicitly direct completed deployments to `verify:arbitrum`, which never requests
a signing key; `deploy:resume` requests a key even when both transactions exist.

A new fork regression proves direct first-claim behavior after the actual V3 game
closure: without a separate settlement call, the first holder receives 150 CST,
another holder's 50 CST remains reserved and is then paid, and 7,950 CST remains
carry. The block number and timestamp do not advance between game closure and
claims. The countdown alone still rejects claims. All three V3 fork tests passed
at fresh snapshot **517030312**:

```sh
CHAOSZERO_V3_FORK_RPC_URL=https://arb1.arbitrum.io/rpc CHAOSZERO_V3_FORK_BLOCK=517030312 forge test --match-contract V3OutcomeSourceForkTest -vv
```

The four ArbOS entropy-read substitutions described above remain necessary. No
public transaction occurred, and no production contract code changed in this
recheck. The original archive endpoint could not serve a newly requested slot at
the older snapshot; the fresh pinned run avoids relying on that unavailable state.
A future reproduction needs an RPC that retains the selected block's state.

## Release behavior and artifacts

Every new pool starts at 50/50. Historical prices, checkpoints and game timestamps
were removed from settlement and initialization. The actual V3 adapter uses a
fixed, explicitly accepted round-2 bootstrap for the first market cycle (3), then
native per-cycle V3 statistics. Its runtime checks reject changed game tokens or
inconsistent states. Normal funding, independent collateral, ERC-1155 positions,
winning escrow and equal carry allocation remain covered by the financial suites.

The source constructor baseline commitment is:

`0x270bdafae80631bde00ccdad3a78ca455a073a900c3d91fb7ead3d0b870f5891`

The exact published evidence file commitment is:

`0x55447a205cd7c242667d30dcaad22f23bb1fd06e4364362dc779e3044c3c02a9`

[The evidence](deployment/arbitrum-round-2-baseline.json) is imported directly by
`/baseline` and `/baseline.json`, with byte-equivalence tests. `pnpm verify:baseline`
reproduces its checks; `--refresh` fetches all public evidence again. This is an
accepted one-time auditable input, **not an on-chain historical proof verifier**.
The same wallet earned both historical titles through different gestures; the
stored same-gesture result is correctly false.

Production runtime sizes are 20,912 bytes for the market (3,664 bytes below
EIP-170), 3,168 for the V3 source, 10,897 for the read helper and 2,634 for the
payout vault. The operator deployment script verifies all four through Hardhat's
Etherscan V2 integration and pins the reviewed game implementation before signing.
Real Arbiscan verification remains unexecuted because deployment is intentionally
deferred. Its integration callback and constructor parameters were tested locally.

Dependency remediation updated affected consumers and transitive resolutions.
The sole unpatched advisory was eliminated by a version-scoped replacement of
Next's lint-only directory glob implementation with `tinyglobby`, keeping all lint
rules. Four regression tests cover the actual consumer API and deep nesting. See
[the frontend dependency rationale](frontend/README.md#dependency-maintenance).

These results describe covered behavior, not a guarantee that no bug exists.
No external security audit or public deployment has occurred.

---

# Independent local prototype validation — 19 September 2026

This records local checks for eight independent pools, ordinary winning payouts,
protected claim escrow, inherited prices and surplus rollover. It is not an
external audit, formal verification or approval for a real-CST deployment.

## Release checks

| Check                       | Result                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete repository gate    | `pnpm check` passed: formatting, build and sizes, contract suites, generated fixtures, independent math oracle, frontend lint/types/coverage/build, browser lifecycle and dependency audits.                                                                                                                                                                                      |
| Default Solidity suite      | 306 tests passed across 21 suites, including the retained legacy and shared engines.                                                                                                                                                                                                                                                                                              |
| Extended Solidity campaigns | 306 tests passed across the main and supplemental campaigns. Fifty-six fuzz properties each ran 50,000 inputs: 2,800,000 generated cases, with no failures.                                                                                                                                                                                                                       |
| Frontend suite              | 1,419 tests passed across 59 files, including 110 new independent-interface tests.                                                                                                                                                                                                                                                                                                |
| Critical frontend coverage  | Independent models and pricing have 100% statement, branch, function and line coverage. Independent action/read hooks have 100% function and line coverage; statements are 98.29% / 100%, branches 97.14% / 99.05%. Enforced thresholds are 98% statements, 95% branches, 100% functions and 99% lines. Existing critical-file gates remain enabled.                              |
| Differential execution      | All three Solidity-generated fixture sets reproduce exactly, including 130 weighted-binary cases. The logarithm oracle independently verifies 631 compiler-generated intervals with 170-digit Decimal arithmetic; deliberate-corruption regressions pass.                                                                                                                         |
| Developer tooling           | 17 tests passed, including staged/pushed revision integrity, fixture restoration, local-only endpoints, occupied-port refusal and compiler/browser ABI agreement rules.                                                                                                                                                                                                           |
| Browser lifecycle           | Fresh Anvil deployment passed buys/sells, isolated prices, transfers and complete-set recovery, continued trading on early-known facts, full settlement, exact eight-way remainder allocation, inherited prices, late source-offline claims and carry-only startup across three cycles. The retained shared-browser spec is explicitly skipped for this independent deployment.   |
| Local-chain smoke           | The actual browser solver executes against compiled contracts. Every declared browser ABI is compared with compiler outputs, including tuple names/types, return values and event indexing. Tests independently reconcile claim escrow, carry, time-window prices and unchanged neighboring pools, then restore the initial snapshot. The browser gate also runs this smoke test. |
| Production builds           | Both the default legacy configuration and the configured independent local-market build passed.                                                                                                                                                                                                                                                                                   |
| Dependency audits           | Root, frontend and production dependency audits reported no known vulnerabilities. OpenZeppelin Contracts is pinned to v5.7.0; JavaScript dependency audits do not audit Solidity.                                                                                                                                                                                                |

The heavy profile also passed 11 stateful invariant properties, each with 512
campaigns of 256 actions: **1,441,792 calls**, with zero handler reverts or
invariant failures. The main campaign took 21.5 minutes; the supplemental
integrated-properties campaign took 2.3 minutes and ran alongside it.

## Financial scenarios

The independent engine tests all 256 final answer vectors with asymmetric holdings
across three holders. Stateful tests use four actors and six cycles, checking an
independent cash/holdings ledger after trades, gifts, pair operations, transfers,
source outages, settlements and claims. Additional properties compare merging
before/after settlement, skipped unfunded cycles, no-bet rollover, duplicate
settlement, capacity-limited deferred carry and claims far into the future.

Seventy-two token-callback attack combinations cover active transfers, vault
transfers and automatic settlement during funding. ERC-1155 receiver tests keep
standard forwarding and receipt-time pair redemption available while preventing
nested guarded financial operations. Exact incoming and outgoing collateral
checks reject short/taxed transfers without consuming claims or borrowing prior
surplus. The earlier shared engine's complete terminal and 6,561 partial-answer
enumerations remain regression coverage.

## Reproduction

The extended campaigns use this seed:

```sh
FOUNDRY_PROFILE=heavy \
FOUNDRY_FUZZ_SEED=0xc18ba92570efdb6b84d0929a275cf11b0749d452e38a7f0a63d970e8bd59e248 \
ARBITRUM_RPC_URL= forge test --threads 4 -vv
```

The recorded main campaign began before the new integrated properties file was
added. That file ran separately with the same seed/profile and `--threads 2
--match-contract IndependentMarketPropertiesTest`. No financial logic changed
during either run; a later comment and metadata-spacing cleanup was covered by
the complete default gate. A fresh reproduction now includes both in one run.

Environment: Node 24.2.0, Python 3.13.5, pnpm 10.32.0, Foundry 1.7.1 and Solidity
0.8.35. CI pins Node 22.23.2. Tests and deployment builds use the same compiler
and optimizer settings. Git hooks and CI enforce the default suites; scheduled
CI runs the heavy profile and retains its seed and failure artifacts.

## Limits

The independent market runtime is **24,467 bytes**, leaving **109 bytes** below
the 24,576-byte EIP-170 limit. Its immutable helper contains read-only previews,
metadata and pure product verification; no fund custody or configurable
permissions are delegated to it. The separate immutable payout vault holds old
claims. A measured cold weighted-binary buy used **181,358 gas** on the local EVM;
this is not an Arbitrum fee quote or a guarantee for every state.

The live eight-question result adapter remains unimplemented. The local source
and shortened simulator are development tools. The opt-in read-only Arbitrum
fork check concerns the legacy single-question adapter and was not repeated in
this local-only release. No public-chain transaction was submitted.

After settlement, an old cycle's active collateral is zero. Unpaid winnings
remain in its vault, and surplus remains accounted as carry or new-cycle
funding. This does not mean every contract's CST balance is zero. Passing tests
establish the covered accounting/execution properties, not accurate next-cycle
probabilities or resistance to economic influence over the underlying game.

## Addendum: gesture-parity question — 26 September 2026

Question 5 changed from "more CST gestures than ETH gestures" to "odd total
gesture count at closure". Only the local outcome source, the simulator's
statistics record (two unused gesture-type counters removed), the frontend and
the documentation changed. Market, vault and library code is untouched; the
independent market runtime is still **24,467 bytes**.

`pnpm check` passed on the change: 310 Solidity tests across 21 suites (new
parity unit and fuzz properties included), byte-identical regeneration of all
three fixture sets, the 631-interval logarithm oracle, 1,447 frontend tests
across 60 files with enforced coverage, the production build, the browser
lifecycle with its embedded local smoke (parity unknown before closure, then
equal to the final gesture count's parity), and clean dependency audits. The
heavy profile was not rerun because no financial logic changed.

Environment: Node 24.2.0, Python 3.13.5, pnpm 10.32.0, Foundry 1.7.1 and Solidity
0.8.35.

## Addendum: automatic contribution distribution — 26 September 2026

Every CST contribution now reaches the eight pools through one private routine,
`_absorb`. Direct transfers and mints, previously stranded, are split equally by
the next buy, sell or `fundRound` on the trading cycle (implicit triggers need at
least 1 CST held), and a cycle's first trade settles the previous funded cycle
and starts the new pools from carry. Explicit `fundRound` sponsors keep today's
`FundingCapacity` protection. `RoundFunded` has a new signature.

| Check                    | Result                                                                                                                                                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Complete repository gate | `pnpm check` passed: 338 Solidity tests across 22 suites, all fixtures reproduced, the logarithm oracle, 1,476 frontend tests across 60 files with enforced coverage, the production build, the browser lifecycle with its embedded smoke, and clean dependency audits.                                                  |
| Extended campaigns       | Seed `0x0be8fb6ea6afea4d6954abdffada09d90e91fed33609586f2ce3202e01128533`: 338 tests passed; 63 fuzz properties × 50,000 inputs (3,150,000 cases) and 11 invariants × 512 × 256 (1,441,792 calls) with zero reverts, in 15.3 minutes. The edited auto-distribution suite was rerun afterwards with the same seed: 25/25. |
| Browser lifecycle        | A direct transfer during trading is absorbed by the next buy with exact eight-way allocations; cycle 3 is opened by its first buy, with `seedPreview` starting prices. The smoke checks every `RoundFunded` against the preview, sub-threshold waiting, gift sweeping and preview/execution parity.                      |
| Mutation checks          | Fifteen deliberate faults were caught, including absorb-after-pricing, off-by-one thresholds, a split that absorbs, a skipped previous-cycle settlement, swapped event fields, a missing lock, carry reported as held CST, and an unsaturated preview.                                                                   |
| Adversarial review       | Six lenses with two skeptics per finding. No contract defect was confirmed. Two preview test gaps and two documentation inaccuracies were fixed.                                                                                                                                                                         |

The invariant handler models held CST, direct transfers, bare triggers and
trade-triggered starts, and checks each `RoundFunded` against its model. It logs
rather than asserts per-run coverage: sampled single runs of 64 calls absorbed in
56 of 60 runs and auto-started in 49 of 60, so a per-run assertion would be
flaky; each run's teardown auto-start is asserted.

The market runtime is **24,393 bytes** (183 below EIP-170); the helper is 12,338.
Passing a literal instead of the `_noDonation` immutable measured 25,182 bytes.
Gas on the local EVM: the legacy cold-buy probe rose from 181,358 to 185,093
(one balance read). The new probe, at a new timestamp, measures 208,574 for a
buy with nothing held, 208,608 with under 1 CST held, 530,060 for a buy that
first absorbs 100 CST, and 1,237,344 for the first buy of a cycle, which settles
the previous cycle and starts the pools.

Residual limits are recorded in SECURITY.md: held CST under 1 CST can be
partially captured by a pre-positioned trader who sends a 1-wei gift, and each
transfer of at least 1 CST moves one eight-pool absorption's gas onto the next
trader. No public-chain transaction was submitted.

## Addendum: markets end only at round closure — 29 September 2026

Owner decision: markets never end early. Buying, selling, splitting, funding and
automatic distribution continue while answers are known, including all eight,
until the game's round-ending transaction (`claimMainPrize` live, `closeCycle`
locally); neither the countdown nor the claim timeout closes a market, and no
payout precedes finalization. An audit found the market already enforced this:
trading, splitting and funding are gated only on the source's `open` flag,
merges never consult the source, and settlement and claims require `finalized`.
The change therefore adds documentation and tests, not contract code. The
`IOutcomeSource` NatSpec now requires `open` to derive from the game's round
counter until the round-ending transaction and `finalized` to be set in that same
transaction.

The retired shared engine was removed: its contract, tests, deployment and vector
scripts, browser spec, frontend screen and fixture. The historical references
above (the default-suite row, the browser-lifecycle row and the 6,561
partial-answer enumerations) are superseded. The `Log2Bounds` unit tests moved
unchanged to `test/Log2Bounds.t.sol`. The 631-interval logarithm corpus is now
generated by `script/GenerateLogBoundsVectors.s.sol` into
`frontend/src/test/fixtures/log2-bounds-vectors.json`; before the old fixture was
deleted, its 631 log rows were verified equal to the new file entry for entry and
line for line (607 distinct inputs). The oracle now also rejects non-log rows and
corpora with fewer than 607 distinct inputs.

New tests: `test/IndependentRoundEnd.t.sol` (every entry point live at
`knownMask == 0xff` until finalization; against the real local game, trading
continues after `mainPrizeTime` and the claim timeout, including with every
early-knowable answer known (`0x9f`), and stops in the `closeCycle` block; a
closed-but-unfinalized report stops trading and pays nothing; a fuzz property
over known masks), a `LocalGame` adapter test that `open` follows the round
counter, frontend tests for the elapsed-countdown notice and a fully known open
cycle, and a browser assertion after the countdown elapses. An adversarial review
planted early-ending faults: closing on known answers, on the countdown or on the
claim timeout, refusing splits or funding for known questions, paying before
finalization, and trading a closed-but-unfinalized cycle. Each one fails at least
one test.

`pnpm check` passed: 279 Solidity tests across 17 suites; byte-identical
regeneration of all three fixture sets; 10 oracle self-tests and 631 verified
intervals; 18 tooling tests; 1,355 frontend tests across 54 files with enforced
coverage (the `src/shared/math.ts` branch gate is 92%, since only `log2Bounds`
remains and one of its 14 arms is unreachable for valid inputs); the production
build; 1 browser lifecycle flow with its embedded smoke; and clean dependency
audits. The independent market runtime is unchanged at **24,393 bytes** (183
below EIP-170); with the CBOR metadata stripped, its deployed bytecode and those
of the local source and game are identical to before. The heavy profile was not
rerun because no financial logic changed.
