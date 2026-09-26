# Integer product verification

The original shared engine remains covered below. The independent engine uses
the same enclosing logarithms, with the per-question extension at the end.

`SharedOutcomeMarket` stores eight YES liabilities, eight NO liabilities and
accounted collateral `B` for a cycle. For a feasible eight-bit ending `s`, the
pool's virtual reserve is `B - sum(winning liabilities in s)`. Uniform sponsorship
creates a complete set of all 256 outcomes without issuing 256 token balances.
Only unresolved-question binary positions can trade. Known answers eliminate
incompatible endings before the trade is priced.

For each trade, every new feasible reserve must be strictly positive. The
contract then proves that the product of feasible reserves cannot decrease.
Neither the product itself nor a floating-point approximation is computed.

## Enclosing log2 without an assumed error tolerance

Let `Q = 2^127`. For a positive integer `x <= 2^120`, extract its integer binary
exponent `e` and normalize exactly to `z = x * 2^(127-e)`. Thus
`Q <= z < 2Q`; no normalization bits are discarded.

Run independent lower and upper trajectories, both starting at `z`. At every
step square the lower endpoint and divide by `Q`, rounding down; square the
upper endpoint and divide by `Q`, rounding up. Each trajectory independently
extracts bit `d = 1` when its result is at least `2Q`, and divides by two using
the same directed rounding when that bit is set.

If `l'` and `h'` are the resulting normalized endpoints, each step guarantees

```
log2(l / Q) >= (d_low  + log2(l' / Q)) / 2
log2(h / Q) <= (d_high + log2(h' / Q)) / 2.
```

Telescoping 64 steps gives a lower binary prefix and an upper binary prefix.
The final normalized logarithm is between zero inclusive and one exclusive.
Consequently the lower prefix is a lower bound and the upper prefix plus one
Q64 unit is an upper bound. If the final upper endpoint equals `Q`, its suffix
is exactly zero and the extra unit is unnecessary. Exact powers of two bypass
the trajectories and have identical bounds.

Different trajectories can extract different bits. This is essential near a
dyadic logarithm boundary: stopping as soon as a shared interval straddles a
threshold gives a rigorous but potentially very loose bound.

All squares fit in `uint256`: normalized endpoints are at most `2Q - 1`.
For the upper trajectory,

```
ceil((2Q - 1)^2 / Q) = 4Q - 3
ceil((4Q - 3) / 2)  = 2Q - 1.
```

Thus upward rounding cannot escape the normalized range. Ceiling division uses
a quotient and a nonzero-remainder flag; adding `Q - 1` to the square could
overflow and is deliberately avoided.

The acceptance test is

```
sum(lowerLog2(newReserve)) >= sum(upperLog2(oldReserve)).
```

Identical old/new reserves cancel exactly and are skipped. The bound directions
prove `sum(log2(newReserve)) >= sum(log2(oldReserve))`, hence the reserve product
does not decrease. All sums fit comfortably in 256 bits: at most 256 logarithms,
each at most `120 * 2^64`.

Conservative rounding can reject an economically valid trade near exact
equality. It cannot accept an invariant-decreasing trade. Off-chain quote
search must apply the same integer acceptance rule instead of assuming that an
analytic or floating-point quote will execute. The contract executes the exact
cash and token quantities submitted by the user; it does not fill at a different
quantity and does not charge a separate fee.

## Complete sets and ownership

Splitting amount `a` for question `q` increases `B`, `YES[q]`, and `NO[q]` by
`a`. Every ending selects exactly one of those two liabilities. Its reserve
therefore changes by `a - a = 0`. Merging subtracts the same amount from all
three quantities, again changing every reserve by zero. For a batch of
questions this argument adds: collateral falls by the sum of the pairs, and
every ending's winning liability falls by exactly that sum. There is no product
approximation or quote in either operation.

For any feasible ending, the collateral backing the holder's matched pairs is
part of the winning liability. The holder's pairs can therefore be paid even
after sponsor residue is rolled forward. This exit does not require a source
read, a cached answer, or an open cycle. Existing solvency and the ownership
checks suffice. Pairing positions from different questions or cycles would not
have this property and is never allowed.

A cycle may initially contain only split positions. In that case every reserve
is zero and the pool is not marked funded; trading is unavailable until it
receives sponsorship. Claims and merges remain available without sponsorship.
The first gift must meet the funding minimum on its own, independently of
collateral already backing split positions.

ERC-1155 is the only per-holder ledger. Standard transfers change who owns a
claim, but never aggregate supply or collateral, so reserves are unchanged.
Only guarded economic methods mint or burn. Collateral receipt and aggregate
accounting finish before ERC-1155 mint acceptance callbacks. Transfers retain
standard callback forwarding; callbacks cannot reenter a guarded economic
operation while one is already executing. Rejected callbacks revert atomically.

## Funding, partial answers and claims

Additional sponsorship is an irreversible gift that increases all feasible
reserves equally. It may move prices toward equal probabilities. There are no
withdrawable LP shares, and no attempt to keep the pre-gift product invariant.
Each subsequent trade compares against the actual reserves immediately before
that trade.

Known-answer claims reduce `B` and the winning liability by the same amount.
Losing liabilities are removed only for already impossible endings. Every
remaining feasible reserve therefore stays unchanged. After all answers are
final, rollover moves only `B - sum(unpaid winning claims)` to a later open
cycle. Old claims retain their collateral independently of rollover timing.
Once finalization is cached, retrieval uses its permanently fixed answer vector
without a further source read. This changes neither the payout nor its backing,
and preserves redemption if the finalized source later becomes unavailable.

Direct token transfers do not change the accounted collateral. Funding checks
the actual received balance delta; payouts check both sent and received deltas.
Token behavior inconsistent with exact CST transfers reverts atomically.

This is an implementation argument, not an external security audit. The tests
cover high-precision reference vectors, powers of two, a boundary regression,
all 256 terminal endings, source consistency, custody and liability invariants,
and full-state execution gas.

## Independent question pools

For each question, let `C` be its active collateral and `Y, N` its actual issued
YES/NO supply. Its reserves are `rY = C - Y` and `rN = C - N`. No other question
enters either reserve or its trade verification. First funding creates equal
reserves with fixed positive weights `p` and `10000 - p`, where `p` is the
previous cycle's middle-window price in basis points. The invariant is

```text
rY^p * rN^(10000-p).
```

Multiplying each existing logarithm interval by a positive weight preserves its
bound direction. Comparing the weighted new lower sum with the weighted old
upper sum therefore proves non-decrease. Unchanged reserve factors still cancel
exactly. Both reserves must remain positive during trading; `C <= 2^120` bounds
all logarithms, and the weights sum to 10,000. The weighted sums fit below
`2^85`. The marginal YES price is

```text
10000 * p * rN / (p * rN + (10000-p) * rY).
```

Integer floor division gives the displayed basis-point quote. Exact trade
quantities continue to use the enclosing invariant check, not a rounded display
price. Initial weights stay in 1..9999 and never change after initialization.
Additional gifts can move prices toward those fixed initial odds. An absorbed
contribution is such a gift: its allocation `g` raises `C`, and so both `rY` and
`rN`, by `g`. A buy or sell absorbs before its product check, so the trade is
verified against the post-absorption reserves; its exact submitted amounts
either pass that check or revert.

## Settlement and rollover conservation

When the full game result is final, set `O` to this question's winning supply and
`R = C - O`. Solvency guarantees `R >= 0`. Reserve `O` in that question's closed
cycle vault, set its active collateral to zero, and credit `R` to future funding.
Across the eight questions, the exact identity is

```text
old active collateral = new claim escrow + new carry credit.
```

No holder enumeration or prior withdrawal is needed. Every claim later pays
one CST per winning unit from its own escrow. A pair merged before settlement
reduces both `C` and `O` equally, preserving `R`; after settlement it reduces the
winning supply and escrow equally, without touching carry. Transfers alter only
the claim owner. Claim order and multiple wallets cannot gain extra rollover.

Before a new funded cycle starts, the latest previously funded cycle must be
settled. First funding can happen inside the new cycle's first buy or sell: that
call settles the previous cycle, places carry and held contributions, and only
then verifies its own trade. All eligible carry is included before first trading,
divided into eight equal allocations with at most one base-unit difference for
the remainder. Old split-only cycles have no sponsor reserve, so settling them
later adds no carry. Unfunded game-cycle gaps need no unbounded catch-up loop.
Extreme carry above the initial funding headroom cap remains explicitly pending
for later cycles; it is never silently injected into an already-funded pool.

The custody invariants are:

```text
market CST = active question collateral + pending carry + held contributions
vault CST  = outstanding winning claims + unsolicited vault transfers.
```

Held contributions `H = market CST - active - pendingCarry` are CST that arrived
without accounting: direct transfers, mints, and a sponsor's pull just verified
inside `fundRound`. One routine, run by `buy`, `sell` and `fundRound` on an open
cycle, credits them. With carry `K` offered only at first funding and `cap` the
cycle's remaining capacity, let `P = min(H + K, cap)`. If `P` reaches the
threshold (`MIN_FUNDING` at first funding; on a funded cycle 1 CST for trades
and bare triggers, 1 wei for a gift), it places `P` in eight equal allocations
and sets

```text
active' = active + P
pendingCarry' = pendingCarry + H - P
```

so `H` returns to zero and the identity holds. Carry ranks first, then the
sponsor's own pulled CST, which must fit or revert, then unsolicited CST; only
carry and unsolicited CST can be deferred. Settlement lowers market CST and
active collateral by the escrow and moves the surplus from active to pending
carry, leaving `H` unchanged. Vault transfers are never credited. `H` saturates
at zero after unsupported external destruction, so later inflows first restore
the missing backing. All authorized transfers must match exact sent and received
amounts. The same transaction guard covers funding, trades, split/merge,
settlement and claims.

## Middle-window history

Each question records its own quoted YES price and cumulative basis-point-seconds
at each price-changing market operation. Same-timestamp writes replace the last
quote without adding duration. Given canonical game times `start, end`, sample
`t40 = start + floor(2*(end-start)/5)` and
`t60 = start + floor(3*(end-start)/5)`. The average is the difference of the two
cumulative values divided by `t60-t40`, rounded down. Each endpoint uses binary
search and constant-price extrapolation from the preceding checkpoint, so query
cost grows logarithmically rather than with the number of trades in the window.

Missing coverage of the window or a zero-width interval uses the prior initial
seed, or 50% if the immediately preceding cycle has no initialized market. The seed is clamped to the strictly
positive weight range. This is an average of recorded market quotes, not a
claim that old prices correctly forecast the next cycle's different thresholds.
