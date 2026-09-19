# Security scope

The independent eight-question system on this branch is a **local prototype**. It has not received an external security audit and must not be presented as approved for real-CST deployment.

Report suspected financial or authorization vulnerabilities privately to the project maintainers before publishing exploit details. Reproductions should use fake assets on a local chain.

## Security boundaries

- `IndependentOutcomeMarket` has immutable token, outcome-source, payout-vault and read-only helper references. It has no administrator, upgrade mechanism, CST minting authority, or sponsor withdrawal privilege.
- The outcome source is trusted to describe the game truthfully and monotonically. The market rejects contradictions it has already observed, but this does not make an arbitrary source trustworthy. A production source needs a separately reviewed provenance mechanism.
- The supported collateral must have standard, exact transfers. Rebasing, transfer taxes, and arbitrary external balance destruction are unsupported. CST's upstream mint/burn authority and the game's upgradeability are part of a future deployment review.
- The local game, local token, and local source cannot be constructed on a chain other than `31337`. The prototype frontend additionally refuses public-chain operation.
- All economic entry points share a reentrancy guard. CST movements are verified by balance deltas. Direct CST transfers do not create claims or credited funding.
- ERC-1155 transfers retain standard receiver-callback composability: a receiver may forward newly received positions. All collateral and aggregate accounting is complete before safe-mint callbacks, and nested economic operations during a guarded operation revert. A receiver can redeem newly received pairs during a standalone position transfer; receiver rejection rolls back the entire call.
- ERC-1155 is the sole holder-balance ledger. Issuance and redemption update aggregate liabilities; transfers and operator approvals do not. An operator approved for all positions can transfer them to itself and redeem them. Treat that approval as authority over every current and future position held by the approving wallet.
- Complete-set merges redeem only equal YES/NO quantities from the same question and cycle. They do not call the outcome source and remain available after settlement or rollover; settled merges pay from the original question’s escrow. Splitting requires an open cycle but no sponsor. Split-only cycles settle without first receiving a gift.
- All eight questions settle only after full game closure. Trading can continue while an answer is already known. Once settlement is cached, retrieval uses fixed answers without calling the source again. Before that, retrieval validates the source and canonical cycle times.
- Each trading question must independently back both answers. At settlement, its entire winning supply is reserved before surplus is credited to future funding. Unclaimed user funds never become sponsorship. Transfers and claim order cannot change the amount carried forward.

## Economic limitations

Collateralization is not a guarantee that a prediction is profitable or that its underlying game outcome is difficult to influence. Participants can place additional game gestures, affect payment counts, and choose when to finalize a cycle. Prediction-market subsidies add incentives to do so. A real-CST pilot needs economic attack analysis in addition to code review.

Sponsorship is an irreversible contribution to other participants' trading opportunities. There are no redeemable LP shares. Additional voluntary funding may move prices toward the fixed initial odds. Automatic carry is applied only before first funding of a new cycle. Numerical headroom limits can leave exceptional excess carry pending for later cycles. The protocol does not promise to distribute every sponsored unit as trader profit in each cycle; all unused credited collateral rolls forward. There is no winning-holder surplus bonus.

The integer product test uses conservative, rigorously enclosing logarithm bounds. Tiny trades can be unquotable at some reserve sizes. A displayed exact quote can become invalid when the pool or source changes; a rejected transaction leaves contract state unchanged but still costs network gas.

Recorded middle-window prices can be influenced and need not be calibrated probabilities for the next cycle. The time-weighted history prevents same-timestamp updates from gaining extra time weight, but does not eliminate market manipulation or compensate for changing game conditions.

## Verification and release expectations

Required gates include Solidity unit/fuzz/stateful tests, all terminal and partial answer configurations, frontend differential and property tests, a real local-chain browser lifecycle, dependency audits, and a production build. The nightly profile records reproducible seeds and retains failure artifacts.

Before real-value deployment, require an immutable authenticated result adapter for all eight questions, complete historical baselines, a liveness and recovery plan, Arbitrum gas measurements, and an independent review of financial invariants and numerical bounds. The local simulator and a caller-supplied result report are not acceptable substitutes.

Never use real wallet keys in local scripts. The provided launcher uses Anvil's disposable unlocked accounts and loopback networking only.
