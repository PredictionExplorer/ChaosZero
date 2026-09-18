# Local prototype validation — 18 September 2026

This records the completed local checks for the eight-question prototype. It is not an external audit, formal verification, or authorization to deploy the local outcome source with real assets.

## Final checks

| Check                                  | Result                                                                                                                                                                                               |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete repository gate, `pnpm check` | Passed: formatting, contracts, differential fixtures, mathematical oracle, lint, types, coverage, production build, browser lifecycle, dependency audits.                                            |
| Default Solidity suite                 | 176 tests passed.                                                                                                                                                                                    |
| Heavy Solidity suite                   | 176 tests passed; 50,000 inputs for each of 30 fuzz properties, totaling 1,500,000 generated cases.                                                                                                  |
| Heavy stateful invariants              | Eight invariant properties, each with 512 campaigns of 256 calls; no handler reverts or invariant failures.                                                                                          |
| Final outcome enumeration              | All 256 answers exercised.                                                                                                                                                                           |
| Partial outcome enumeration            | All 6,561 unknown/NO/YES assignments exercised, including payouts and remaining reserves.                                                                                                            |
| Transfer callback attacks              | 20 combinations of transfer path and attempted reentrant mutation exercised.                                                                                                                         |
| Frontend suite                         | 1,120 tests passed across 46 files.                                                                                                                                                                  |
| Critical frontend math and hooks       | Shared math and shared transaction/data hooks have 100% line coverage; both legacy market hooks have 100% statement, branch, function and line coverage. Critical-file thresholds are enforced.      |
| Numerical differential corpus          | 631 actual Solidity logarithm intervals and 12 trade cases checked against TypeScript; logarithms independently checked with 170-digit Decimal arithmetic.                                           |
| Oracle failure tests                   | Eight tests, including deliberate interval corruption that must fail the command.                                                                                                                    |
| Developer tooling                      | Twelve regression tests covering staged/pushed contents, fixture restoration, local-only endpoints and occupied-port refusal.                                                                        |
| Browser lifecycle                      | Passed against newly deployed local contracts, including exact frontend quotes, approvals, sponsorship, buying, selling, game gestures, partial retrieval, finalization, rollover and mobile layout. |
| Independent local-chain smoke          | Four question positions exercised, with exact quote/execution agreement and custody reconciliation; the test restores its starting snapshot.                                                         |
| Production builds                      | Both default legacy configuration and configured local shared-market configuration passed.                                                                                                           |
| Legacy live-game compatibility         | Passed on an Arbitrum fork, including current/future-round flows. No public-chain transaction was submitted.                                                                                         |
| Dependency audits                      | No reported vulnerabilities in root tools, frontend dependencies, or production dependencies.                                                                                                        |

The heavy campaign completed in approximately 16.5 minutes on the development machine. Reproduce its seed with:

```sh
FOUNDRY_FUZZ_SEED=0x5eca90fe46c7908edaf3b72d746e0f4fbbecc6cb3789e2a8d3b90ea515402326 pnpm test:heavy
```

The local validation environment used Node 24.2.0, Python 3.13.5, pnpm 10.32.0, Foundry 1.7.1 and Solidity 0.8.35. CI pins Node 22.23.2. The contract compiler configuration and optimizer are identical for tests and builds.

## Issues found and retained as regressions

- Conservative interval arithmetic has a valid dust acceptance point that an ordinary monotone quote search can miss. The frontend explicitly verifies cancellation candidates.
- An adversarial sequence of immediate CST gestures exceeded the local fuzz harness's original funding. The harness now funds that path and tests it directly instead of discarding it.
- The local mock wallet needed the configured RPC in its chain metadata, not only the read transport.
- Time-sensitive game actions could need more gas in the mined block than an estimate made at the preceding timestamp. Local actions use bounded gas headroom and preflight simulation.
- Cached market data must not leave transaction controls active after RPC or source-consistency errors.
- Shared writes validate both wallet and RPC network identity and include an explicit chain ID.
- The existing market's React-state-only pending flag permitted same-tick duplicate calls. A synchronous ref guard now prevents them.
- Missing legacy targets and failed wallet balance/allowance reads now fail closed instead of forwarding invalid requests or silently hiding positions.

## Limits of these results

The shared market's result adapter remains a local simulator adapter. Historical proof verification for the live game is not implemented. The local simulator intentionally shortens timers and simplifies nonessential game mechanics; the separate champion reference tests validate its record logic.

Measured full-state trades use approximately 9.4 million gas on the local EVM. This is not an Arbitrum transaction-fee quote or a public-network performance certification. Tests establish the covered accounting and execution properties, not resistance to participants economically influencing the underlying game.
