# V3 integration and historical bootstrap

The September storage proposal is superseded by the deployed Cosmic Signature V3
and the fixed 50/50 opening policy in this checkout. **No game changes are required
for the eight questions or the AMM's opening prices.**

The public `roundStats(round)` getter now retains total gestures, actual ETH and
CST charges, maximum individual CST charge, final Endurance and Chrono durations,
and a flag identifying the same individual gesture earning both titles. The
adapter reads current durations with `tryGetCurrentChampions`. Its open/finalized
state follows `roundNum`; the countdown is not a settlement condition.

Every pool now starts at 5000 basis points. Historical first-gesture and closure
timestamps are no longer required anywhere in market settlement or price seeding.
No replacement timestamp oracle is necessary.

## First market cycle

The intended first market cycle is 3. Its comparison baseline is cycle 2, which
finished under V2. Gesture count remains available, but the newly introduced V3
statistics are zero because they were not recorded. Those zeros are not valid
historical outcomes.

The accepted bootstrap reconstructs cycle 2 from its complete gesture event
sequence and canonical block times, cross-checks count and per-wallet payment
totals against persistent game storage, and replays the champion record episodes.
The same wallet can own both final records through different gestures, so wallet
equality alone must never determine the shared-title answer.

A reviewed baseline is fixed at adapter construction. Its public `baselineHash`
binds the game, baseline cycle and every baseline value. There is no result setter
or administrator correction path. Later cycles read only permanent V3 records.

This bootstrap is an independently reproducible historical input, not an on-chain
receipt or storage proof. The one-time trust boundary was explicitly accepted for
this launch, and the [published evidence](deployment/arbitrum-round-2-baseline.json)
was checked against independent RPC providers. The deployment script must never
silently substitute zero values, operator-entered guesses, a different baseline,
or a different game. See [DEPLOYMENT.md](DEPLOYMENT.md).

## Dependency behavior

The production adapter is immutable; the upstream game is an upgradeable proxy.
Deployment validates the expected production game and CST addresses and the V3
getter shape. A changed or unavailable upstream source can prevent unsettled
positions from being paid. Matched-pair merges do not need the source, and winning
claims become source-independent after settlement reserves their collateral.
