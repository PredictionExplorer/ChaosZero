# Security scope

The shared eight-question system on this branch is a **local prototype**. It has not received an external security audit and must not be presented as approved for real-CST deployment.

Report suspected financial or authorization vulnerabilities privately to the project maintainers before publishing exploit details. Reproductions should use fake assets on a local chain.

## Security boundaries

- `SharedOutcomeMarket` has immutable token and outcome-source references. It has no administrator, upgrade mechanism, CST minting authority, or sponsor withdrawal privilege.
- The outcome source is trusted to describe the game truthfully and monotonically. The market rejects contradictions it has already observed, but this does not make an arbitrary source trustworthy. A production source needs a separately reviewed provenance mechanism.
- The supported collateral must have standard, exact transfers. Rebasing, transfer taxes, and arbitrary external balance destruction are unsupported. CST's upstream mint/burn authority and the game's upgradeability are part of a future deployment review.
- The local game, local token, and local source cannot be constructed on a chain other than `31337`. The shared frontend additionally refuses public-chain operation.
- All economic entry points share a reentrancy guard. CST movements are verified by balance deltas. Direct CST transfers do not create claims or credited funding.
- ERC-1155 transfers retain standard receiver-callback composability: a receiver may forward newly received positions. All collateral and aggregate accounting is complete before safe-mint callbacks, and nested economic operations during a guarded operation revert. A receiver can redeem newly received pairs during a standalone position transfer; receiver rejection rolls back the entire call.
- ERC-1155 is the sole holder-balance ledger. Issuance and redemption update aggregate liabilities; transfers and operator approvals do not. An operator approved for all positions can transfer them to itself and redeem them. Treat that approval as authority over every current and future position held by the approving wallet.
- Complete-set merges redeem only equal YES/NO quantities from the same question and cycle. They do not call the outcome source and remain available after finalization or rollover. Splitting requires an unresolved open question, but no sponsor. Split-only cycles support ordinary settlement without first receiving a gift.
- Once finalization has been successfully cached, winner retrieval uses those fixed answers without calling the source again. Prior to cached finalization, retrieval still synchronizes and validates the source; source failures cannot silently choose new answers.
- Every trading state must back every feasible final answer. Known-answer payouts and rollover preserve each remaining claim's backing. Unclaimed user funds never become another cycle's sponsorship.

## Economic limitations

Collateralization is not a guarantee that a prediction is profitable or that its underlying game outcome is difficult to influence. Participants can place additional game gestures, affect payment counts, and choose when to finalize a cycle. Prediction-market subsidies add incentives to do so. A real-CST pilot needs economic attack analysis in addition to code review.

Sponsorship is an irreversible contribution to other participants' trading opportunities. There are no redeemable LP shares. Additional funding may move prices. The protocol does not promise to distribute every sponsored unit in each cycle.

The integer product test uses conservative, rigorously enclosing logarithm bounds. Tiny trades can be unquotable at some reserve sizes. A displayed exact quote can become invalid when the pool or source changes; a rejected transaction leaves contract state unchanged but still costs network gas.

## Verification and release expectations

Required gates include Solidity unit/fuzz/stateful tests, all terminal and partial answer configurations, frontend differential and property tests, a real local-chain browser lifecycle, dependency audits, and a production build. The nightly profile records reproducible seeds and retains failure artifacts.

Before real-value deployment, require an immutable authenticated result adapter for all eight questions, complete historical baselines, a liveness and recovery plan, Arbitrum gas measurements, and an independent review of financial invariants and numerical bounds. The local simulator and a caller-supplied result report are not acceptable substitutes.

Never use real wallet keys in local scripts. The provided launcher uses Anvil's disposable unlocked accounts and loopback networking only.
