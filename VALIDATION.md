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
