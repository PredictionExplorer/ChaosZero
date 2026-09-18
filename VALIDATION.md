# Local prototype validation — 18 September 2026

This records local checks for the eight-question prototype with complete-set split/merge and transferable ERC-1155 positions. It is not an external audit, formal verification, or authorization to deploy the local outcome source with real assets.

## Final checks

| Check                                  | Result                                                                                                                                                                                                                                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete repository gate, `pnpm check` | Passed: formatting, contracts, differential fixtures, mathematical oracle, lint, types, coverage, production build, browser lifecycle, dependency audits.                                                                                                                                                       |
| Default Solidity suite                 | 204 tests passed.                                                                                                                                                                                                                                                                                               |
| Heavy Solidity suite                   | 204 tests passed; 50,000 inputs for each of 32 fuzz properties, totaling 1,600,000 generated cases.                                                                                                                                                                                                             |
| Heavy stateful invariants              | Eight invariant properties, each with 512 campaigns of 256 calls; no handler reverts or invariant failures.                                                                                                                                                                                                     |
| Final outcome enumeration              | All 256 answers exercised.                                                                                                                                                                                                                                                                                      |
| Partial outcome enumeration            | All 6,561 unknown/NO/YES assignments exercised, including payouts and remaining reserves.                                                                                                                                                                                                                       |
| Transfer callback attacks              | 56 CST callback combinations plus 16 nested economic attempts from ERC-1155 mint callbacks; standard receiver forwarding and receipt-time redemption remain supported.                                                                                                                                          |
| Frontend suite                         | 1,167 tests passed across 50 files.                                                                                                                                                                                                                                                                             |
| Critical frontend math and hooks       | Position helpers and source-independent recovery hooks have 100% statement, branch, function and line coverage; shared math and shared transaction/data hooks have 100% line coverage; both legacy market hooks have 100% statement, branch, function and line coverage. Critical-file thresholds are enforced. |
| Numerical differential corpus          | 631 actual Solidity logarithm intervals and 12 trade cases checked against TypeScript; logarithms independently checked with 170-digit Decimal arithmetic.                                                                                                                                                      |
| Oracle failure tests                   | Eight tests, including deliberate interval corruption that must fail the command.                                                                                                                                                                                                                               |
| Developer tooling                      | Thirteen regression tests covering staged/pushed contents, pinned dependency availability, lockfile gates, fixture restoration, local-only endpoints and occupied-port refusal.                                                                                                                                 |
| Browser lifecycle                      | Passed with fresh contracts: quotes, sponsorship, trades, split/merge, batch merges, two-wallet transfers and recipient redemption, source-outage recovery, settlement and rollover. Two consecutive runs also passed on the same server with full chain restoration between them.                              |
| Independent local-chain smoke          | Four trading questions plus exact complete-set operations, operator transfers/revocation, split-only settlement and custody/reserve reconciliation. Browser ABI signatures match Solidity compiler outputs. The test restores its starting snapshot.                                                            |
| Production builds                      | Both default legacy configuration and configured local shared-market configuration passed.                                                                                                                                                                                                                      |
| Legacy live-game compatibility         | The earlier baseline passed on a read-only Arbitrum fork. That opt-in live check was not repeated for this local-only position extension; no public-chain transaction was submitted.                                                                                                                            |
| Dependency audits                      | No reported vulnerabilities in the JavaScript root tools, frontend dependencies, or production dependencies. OpenZeppelin Contracts is pinned to v5.7.0 and tested with the market; npm audits do not audit Solidity.                                                                                           |

The heavy campaign completed in approximately 17.7 minutes on the development machine. Reproduce the recorded seed and execution settings with:

```sh
FOUNDRY_PROFILE=heavy FOUNDRY_FUZZ_SEED=0x589e470dbd723bf51ae34932b67ea90457a09cef690b77acb80d6821f4129253 ARBITRUM_RPC_URL= forge test --threads 4 -vv
```

The local validation environment used Node 24.2.0, Python 3.13.5, pnpm 10.32.0, Foundry 1.7.1 and Solidity 0.8.35. CI pins Node 22.23.2. The contract compiler configuration and optimizer are identical for tests and builds.

## Issues found and retained as regressions

- Finalized claims no longer depend on the outcome source remaining available after answers are permanently cached. Transferred winners remain redeemable after rollover.
- Recovery polling preserves in-progress forms while blocking writes until fresh balances arrive; wallet, market and cycle changes reset those forms.
- Transactions bind the sender through wallet submission, preventing a wallet switch during preflight from silently changing the sending account.
- Split/merge confirmations preserve all 18 decimals rather than rounding tiny or large exact payouts.
- Browser retries restore the whole chain, avoiding state leakage from a failed previous attempt.

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

The shared market runtime is 18,840 bytes, below the 24,576-byte limit. Measured full-state trades use approximately 9.94 million gas on the local EVM. This is not an Arbitrum transaction-fee quote or a public-network performance certification. Tests establish the covered accounting and execution properties, not resistance to participants economically influencing the underlying game.
