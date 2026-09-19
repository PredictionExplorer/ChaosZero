# Independent local prototype validation — 19 September 2026

This records local checks for eight independent pools, ordinary winning payouts,
protected claim escrow, inherited prices and surplus rollover. It is not an
external audit, formal verification or approval for a real-CST deployment.

## Release checks

| Check                       | Result                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete repository gate    | `pnpm check` passed: formatting, build and sizes, contract suites, generated fixtures, independent math oracle, frontend lint/types/coverage/build, browser lifecycle and dependency audits.                                                                                                                                                                                      |
| Default Solidity suite      | 306 tests passed across 21 suites, including the retained legacy and shared engines.                                                                                                                                                                                                                                                                                              |
| Extended Solidity campaigns | In progress; final counts will be recorded before release.                                                                                                                                                                                                                                                                                                                        |
| Frontend suite              | 1,419 tests passed across 59 files, including 110 new independent-interface tests.                                                                                                                                                                                                                                                                                                |
| Critical frontend coverage  | Independent models and pricing have 100% statement, branch, function and line coverage. Independent action/read hooks have 100% function and line coverage; statements are 98.29% / 100%, branches 97.14% / 99.05%. Enforced thresholds are 98% statements, 95% branches, 100% functions and 99% lines. Existing critical-file gates remain enabled.                              |
| Differential execution      | All three Solidity-generated fixture sets reproduce exactly, including 130 weighted-binary cases. The logarithm oracle independently verifies 631 compiler-generated intervals with 170-digit Decimal arithmetic; deliberate-corruption regressions pass.                                                                                                                         |
| Developer tooling           | 17 tests passed, including staged/pushed revision integrity, fixture restoration, local-only endpoints, occupied-port refusal and compiler/browser ABI agreement rules.                                                                                                                                                                                                           |
| Browser lifecycle           | Fresh Anvil deployment passed buys/sells, isolated prices, transfers and complete-set recovery, continued trading on early-known facts, full settlement, exact eight-way remainder allocation, inherited prices, late source-offline claims and carry-only startup across three cycles. The retained shared-browser spec is explicitly skipped for this independent deployment.   |
| Local-chain smoke           | The actual browser solver executes against compiled contracts. Every declared browser ABI is compared with compiler outputs, including tuple names/types, return values and event indexing. Tests independently reconcile claim escrow, carry, time-window prices and unchanged neighboring pools, then restore the initial snapshot. The browser gate also runs this smoke test. |
| Production builds           | Both the default legacy configuration and the configured independent local-market build passed.                                                                                                                                                                                                                                                                                   |
| Dependency audits           | Root, frontend and production dependency audits reported no known vulnerabilities. OpenZeppelin Contracts is pinned to v5.7.0; JavaScript dependency audits do not audit Solidity.                                                                                                                                                                                                |

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
