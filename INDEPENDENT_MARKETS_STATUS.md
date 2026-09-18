# Independent-market update: foundations only

Branch: `codex/independent-eight-markets`. The running application still uses the
previous shared market. No independent market has been deployed or presented as
complete.

Implemented foundations:

- Independent weighted binary pricing in Solidity and TypeScript, with exact
  collateral checks, conservative logarithm bounds, and 130 compiler-generated
  cross-language vectors.
- Packed, time-weighted price checkpoints and logarithmic-time lookup of a
  completed cycle's 40–60% average. Missing coverage has an explicit fallback;
  same-timestamp updates carry no extra time weight.
- Canonical cycle start/closure timestamps in the local game/source, including
  valid baseline history on chains starting near Unix epoch.
- A policy-neutral settlement vault that keeps each closed cycle/question's
  unpaid CST separate from active liquidity and every other claim.

The remaining implementation depends on **who receives leftover CST**. A normal
fixed-product AMM retains a reserve even when the answer becomes known. Moving
that reserve to a vault alone does not distribute it.

A bonus proportional to winning shares creates a specific strategy: if nobody
else holds positions, splitting one token unit into YES and NO just before
closure captures the entire sponsored reserve whichever answer wins. Buying
both sides or separating the legs across wallets also defeats simple exclusions.
This can be an intentional participation reward, but is not a selective reward
for successful forecasting.

Pending user choice: send residue to a separate rewards treasury while preserving
standard 1-CST payouts; accept the both-sides strategy and pay winning-holder
bonuses; or specify a separate forecasting-reward mechanism. The bonus was
initially suggested and then explicitly withdrawn as a default after this review.

Once chosen, finish the independent engine, atomic eight-way funding, settlement
distribution, inherited initial prices, UI/local deployment, and complete
end-to-end and stateful tests. Preserve ERC-1155 transfers, split/merge safety,
exact custody, local-only execution, and unclaimed payouts. Earlier shared-market
code/tests remain as regression coverage, not the new engine.

Foundation validation: 265 Solidity tests and 1,309 frontend tests passed. Targeted
extended campaigns passed 950,000 generated cases across binary pricing, price
history, canonical timestamps and payout-vault accounting. All three generated
fixture checks and the independent logarithm oracle passed. The new TypeScript
pricing module has 100% measured statement, branch, function and line coverage,
with mandatory coverage thresholds. These results do not validate an integrated
independent market or a reward policy that has not yet been selected.
