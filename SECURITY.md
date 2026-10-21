# Security scope

The independent eight-question system includes a production V3 adapter and an interactive deployment workflow. It has not received an external security audit. Local tests do not authorize a public deployment or establish that a release is free of defects.

Report suspected financial or authorization vulnerabilities privately to the project maintainers before publishing exploit details. Reproductions should use fake assets on a local chain.

## Security boundaries

- `IndependentOutcomeMarket` has immutable token, outcome-source, payout-vault and read-only helper references. It has no administrator, upgrade mechanism, CST minting authority, or sponsor withdrawal privilege.
- The outcome source is trusted to describe the game truthfully and monotonically. The market rejects contradictions it has already observed, but this does not make an arbitrary source trustworthy. V3 results come from permanent game records. The first comparison uses a frozen historical baseline reconstructed from V2 events and independently cross-checked. That one-time input is not verified by an on-chain proof; review its published provenance and reproducible verification before release.
- The source alone decides when markets end. Its `open` flag must derive from the game's round counter: the current round is open from the time every earlier round is finalized until the game's round-ending transaction (`claimMainPrize`) advances that counter, and `finalized` becomes true, with all eight answers, in that same transaction. An adapter that closes a cycle when the countdown reaches zero, when the claim timeout elapses or when answers become known violates the design; the market has no independent check.
- The supported collateral must have standard, exact transfers and a truthful `balanceOf`. Rebasing, transfer taxes, and arbitrary external balance destruction are unsupported. CST's upstream mint/burn authority and the game's upgradeability are part of a future deployment review.
- The market trusts its absolute CST balance: anything above active collateral plus pending carry is held contributions, later credited to pools or pending carry. If market CST is destroyed externally, that excess saturates at zero rather than blocking trading, and later inflows first restore the missing backing; the shortfall itself is not otherwise covered.
- The local game, local token, and local source cannot be constructed on a chain other than `31337`. The production frontend supports Arbitrum only with matching configured market, adapter, game and CST addresses; simulator controls remain local-only.
- All economic entry points share a reentrancy guard. CST movements are verified by balance deltas. `fundRound` pulls the sponsor's CST first, then credits it. Direct CST transfers and mints to the market create no claims; they become irrevocable pool funding only through the single absorption routine run by `buy`, `sell` and `fundRound`. Mistaken transfers cannot be refunded. Splits, merges, claims, settlement and position transfers never absorb.
- ERC-1155 transfers retain standard receiver-callback composability: a receiver may forward newly received positions. All collateral and aggregate accounting is complete before safe-mint callbacks, and nested economic operations during a guarded operation revert. A receiver can redeem newly received pairs during a standalone position transfer; receiver rejection rolls back the entire call.
- ERC-1155 is the sole holder-balance ledger. Issuance and redemption update aggregate liabilities; transfers and operator approvals do not. An operator approved for all positions can transfer them to itself and redeem them. Treat that approval as authority over every current and future position held by the approving wallet.
- Complete-set merges redeem only equal YES/NO quantities from the same question and cycle. They do not call the outcome source and remain available after settlement or rollover; settled merges pay from the original question’s escrow. Splitting requires an open cycle but no sponsor. Split-only cycles settle without first receiving a gift.
- Markets never end early: trading, splitting, funding and absorption continue while answers are known, until the game's round-ending transaction, and merging never stops. No payout precedes finalization; all eight questions settle together. Once settlement is cached, retrieval uses fixed answers without calling the source again. Before that, retrieval validates the source and final answers. No canonical cycle timestamps are needed.
- Each trading question must independently back both answers. At settlement, its entire winning supply is reserved before surplus is credited to future funding. Unclaimed user funds never become sponsorship. Transfers and claim order cannot change the amount carried forward.

## Economic limitations

Collateralization is not a guarantee that a prediction is profitable or that its underlying game outcome is difficult to influence. Participants can place additional game gestures, affect payment counts, and choose when to finalize a cycle. Prediction-market subsidies add incentives to do so. A real-CST pilot needs economic attack analysis in addition to code review.

A question whose answer is already known keeps trading until the round-ending transaction, so informed traders can buy the known outcome and take that question's own funding. Isolation limits this to the known question; the other seven pools are unaffected. This is the intended trade-off for never ending a market early.

Sponsorship, through `fundRound` or a direct transfer, is an irreversible contribution to other participants' trading opportunities. There are no redeemable LP shares. Additional funding may move prices toward the fixed initial odds. Carry is applied only at the first funding of a new cycle. Numerical headroom limits can leave exceptional excess carry or held contributions pending for later cycles. The protocol does not promise to distribute every sponsored unit as trader profit in each cycle; all unused credited collateral rolls forward. There is no winning-holder surplus bonus.

Held contributions are distributed only by the next `buy`, `sell` or `fundRound` on an open cycle; a transfer alone changes no pool. Absorption runs before a trade is priced, so once at least 1 CST (`MIN_AUTO_TOP_UP`) is held and fits the pools' capacity, no trade executes against pre-gift reserves. Implicit triggers leave smaller amounts held, and one transaction can pre-position, sweep them with a 1-wei `fundRound` gift, and unwind, capturing part of an amount below 1 CST. Sending at least 1 CST makes the next trader pay for eight pool updates while deepening the pools. A gift can make an in-flight exact quote revert, never fill worse.

The first buy or sell of a new cycle settles the previous funded cycle and starts the new pools, so it costs more gas than an ordinary trade. The frontend estimates the complete transaction before submission. That trade can revert with the previous cycle's settlement errors (`NotFinalized`, `InvalidSourceState`, `TransferFailed`) or `OutOfOrderRound`, and with `NotFunded` when carry plus held CST is below `MIN_FUNDING`.

The integer product test uses conservative, rigorously enclosing logarithm bounds. Tiny trades can be unquotable at some reserve sizes. A displayed exact quote can become invalid when the pool or source changes; a rejected transaction leaves contract state unchanged but still costs network gas.

Every new pool starts at 50/50. This fixed opening rule is not a calibrated forecast; informed participants may immediately find one side underpriced. There is no cross-cycle price inheritance or historical timestamp dependency.

## Verification and release expectations

Required gates include Solidity unit/fuzz/stateful tests, all 256 terminal answer vectors and known-answer-while-open lifecycle tests, frontend differential and property tests, a real local-chain browser lifecycle, dependency audits, and a production build. The nightly profile records reproducible seeds and retains failure artifacts.

Before real-value deployment, require an reviewed immutable V3 result adapter for all eight questions, a verified and explicitly accepted historical launch baseline, a liveness and recovery plan, Arbitrum gas measurements, and an independent review of financial invariants and numerical bounds. The local simulator and a caller-supplied result report are not acceptable substitutes.

Never use real wallet keys in local scripts. The provided launcher uses Anvil's disposable unlocked accounts and loopback networking only.
