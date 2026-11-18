# Gas benchmarks for the game-funded V4 market

From the repository root, run:

```sh
node scripts/check-v4-gas.mjs
```

Use Foundry 1.7.1, the pinned submodules and the default Solidity 0.8.35 production profile (Osaka, via IR, 1,000,000 optimizer runs). The runner enables transaction isolation. Each snapshot records gas consumed inside the market call frame, including its nested calls. Setup, subsequent assertions, intrinsic transaction gas, calldata costs, fee pricing and end-of-transaction refunds are outside the measurement.

The fixture deploys the production `GameFundedOutcomeMarket`, read helper and settlement vault. It uses the repository’s disposable local game, CST and outcome source. Gas values therefore measure changes to these fixed executions. Costs on Arbitrum also depend on the deployed token and adapter, chain state and data fees.

| Scenario                                   | What the benchmark checks                                                                                                                                                                                      |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First and repeated funding synchronization | Exactly 8,000 CST enters active collateral, 1,000 per question. Repeating synchronization leaves all balances intact.                                                                                          |
| First synchronization after unused cycles  | The market consumes the correct cumulative grants after both one and 32 quiet cycles. Their gas values make changes in catch-up cost visible.                                                                  |
| Active positions                           | Buys, sells, splits, single merges and eight-question batch merges reconcile the trader’s tokens and each pool’s collateral.                                                                                   |
| Explicit settlement                        | All eight questions have outstanding positions. Settlement sets aside the exact liability of each question. The next opening and subsequent redemptions reconcile against the vault’s CST balance.             |
| Automatic settlement during a trade        | The first buy of a new cycle settles an earlier traded cycle and includes two unused grants. One holder merges old pairs, then another redeems the remaining winning units against the earlier cycle’s escrow. |

CI compares every name and value against [the committed snapshot](../snapshots/GameFundedGasBenchmarksTest.json) with zero tolerance. It generates the observations in an empty temporary directory, so checking does not rewrite the baseline or retain removed measurements. For an intentional change, run `node scripts/check-v4-gas.mjs --update`, review the resulting diff and explain the cause in the PR. The suite lives under `benchmarks/` to keep uninstrumented gas measurements separate from ordinary test and coverage runs.
