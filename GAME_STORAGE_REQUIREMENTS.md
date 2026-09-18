# Game storage needed for ChaosZero

**Add one permanent statistics record per cycle.** The missing data is for automatic settlement of the eight questions; AMM trading, splitting and merging need no additional game storage.

Reuse `getTotalNumBids(round)` for total gestures. Derive ETH gestures as **total − CST gestures**. The current **V3 source already saves** both final durations in `championDurations[round]`; reuse them. V2 does not save that history, so a V2-based upgrade must also add V3's duration snapshot.

```solidity
struct MarketStats {
    uint256 ethPaid;       // More ETH paid than the previous cycle?
    uint256 cstPaid;       // More CST charged/burned than the previous cycle?
    uint256 maxCstPaid;    // Higher largest individual CST payment?
    uint248 cstGestures;   // More CST gestures than ETH gestures?
    uint8 flags;          // TRACKED_FROM_START=1, FINALIZED=2, SAME_GESTURE=4
}
mapping(uint256 round => MarketStats) public marketStats;
```

This uses **four additional storage slots per cycle**: three amounts and one packed counter/flags word. Keep amounts full-width and use checked arithmetic. Existing per-wallet spending totals are unsuitable for efficient settlement: computing a cycle total requires scanning and deduplicating participants. Event logs alone are not directly readable by another contract.

Implementation:

1. **Record actual payments in the shared gesture paths.** Add final `paidEthPrice_` or `paidPrice_`, including discounts/premiums and excluding refunded ETH and separate contributions. CST means the gross gesture charge, before CST rewards offset it. Increment `cstGestures` even for a zero-price CST gesture; update `maxCstPaid` only on a new maximum.
2. **Track the same-gesture answer with one bit.** Clear `SAME_GESTURE` whenever Endurance is assigned/replaced, **after** evaluating the departing champion's Chrono tenure. Set it whenever Chrono selects the current Endurance record. The existing call order makes each Endurance replacement a different gesture, even for the same wallet. No address comparison or two extra gesture IDs are needed. Resolve this question only at closure.
3. **Freeze history at actual cycle closure.** After both final champion updates and duration snapshots, set `FINALIZED` for fully tracked cycles before resetting state/incrementing `roundNum`. Never overwrite completed records. Reuse `tryGetCurrentChampions()` for live durations; the countdown reaching zero does not finalize a cycle.
4. **Handle activation without invented history.** Set `TRACKED_FROM_START` only when observing a cycle's first gesture. Ignore a partially observed upgrade cycle. The first fully tracked cycle supplies the baseline; enable all eight markets from the following cycle. No administrator-supplied backfill.
5. **Keep settlement read-only and separate.** An adapter reads these records and existing getters in constant time, requiring a fully tracked, finalized baseline. The current cycle must be tracked or still have zero gestures. The six increasing comparisons can resolve YES early; CST-versus-ETH count and same-gesture resolve at closure. Strict-comparison ties resolve NO. Creator-funded CST liquidity needs no game funding hook.

**Upgrade detail:** append the mapping to the shared storage layout and reduce its reserved gap by **one slot**; preserve all existing slots. Wire champion-tracking hooks into **both ordinary gestures and the V3 prize module**—adding them only to `BidStatisticsV3` misses the current hot path. Validate upgrade/module layout parity and measure gesture gas. Differential-test the equality bit against explicit gesture IDs, especially repeated wallets and ties.

Source basis: V2/V3 game code at `0bc80af0`. Follow [Solidity's packing rules](https://docs.soliditylang.org/en/latest/internals/layout_in_storage.html) and [upgrade storage-gap rules](https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable#storage-gaps).
