# Integer product verification

`IndependentOutcomeMarket` verifies every trade through `BinaryMarketMath`,
which uses the enclosing logarithms of `Log2Bounds`. Each question has two
reserves and two fixed positive weights; no other question enters its check.

For each trade, both new reserves must be strictly positive. The contract then
proves that the weighted product of the reserves cannot decrease. Neither the
product itself nor a floating-point approximation is computed.

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

For reserves `rY, rN` with weights `p` and `10000 - p`, the acceptance test is

```
p * lowerLog2(new rY) + (10000-p) * lowerLog2(new rN)
    >= p * upperLog2(old rY) + (10000-p) * upperLog2(old rN).
```

Identical old/new reserves cancel exactly and are skipped. Multiplying each
logarithm interval by a positive weight preserves its bound direction, so the
test proves `p * log2(rY) + (10000-p) * log2(rN)` does not decrease; hence
`rY^p * rN^(10000-p)` does not decrease. Each logarithm is at most `120 * 2^64`
and the weights sum to 10,000, so the weighted sums fit below `2^85`.

Conservative rounding can reject an economically valid trade near exact
equality. It cannot accept an invariant-decreasing trade. Off-chain quote
search must apply the same integer acceptance rule instead of assuming that an
analytic or floating-point quote will execute. The contract executes the exact
cash and token quantities submitted by the user; it does not fill at a different
quantity and does not charge a separate fee.

## Independent question pools

For each question, let `C` be its active collateral and `Y, N` its actual issued
YES/NO supply. Its reserves are `rY = C - Y` and `rN = C - N`. No other question
enters either reserve or its trade verification. First funding creates equal
reserves with fixed positive weights `p` and `10000 - p`, where `p` is the
previous cycle's middle-window price in basis points. The invariant is

```text
rY^p * rN^(10000-p).
```

Every trade must pass the weighted acceptance test above. Both reserves must
remain positive during trading, and `C <= 2^120` bounds all logarithms.
Splitting or merging amount `a` changes `C`, `Y` and `N` by `a` together, so
both reserves and the price stay unchanged without a quote or product check.
ERC-1155 transfers change only the holder, never `C`, `Y` or `N`. The marginal
YES price is

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

Settlement waits for the source's `finalized` flag, set only by the game's
round-ending transaction; answers known earlier neither stop trading nor pay.
Then set `O` to this question's winning supply and `R = C - O`. Solvency
guarantees `R >= 0`. Reserve `O` in that question's closed cycle vault, set its
active collateral to zero, and credit `R` to future funding. Across the eight
questions, the exact identity is

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

## Test coverage

This is an implementation argument, not an external security audit.
`test/Log2Bounds.t.sol` covers every exact power of two, a dyadic boundary
regression, high-precision reference vectors and fuzzed power, doubling and
small-product properties. A compiler-generated corpus of 631 `Log2Bounds`
intervals (`script/GenerateLogBoundsVectors.s.sol`) is checked against 170-digit
`Decimal` logarithms and reproduced bit-for-bit by the browser's `log2Bounds`.
`test/BinaryMarketMath.t.sol` compares weighted checks with exact integer
products. The market tests cover all 256 terminal answer vectors, source
consistency, custody and liability invariants, and trade gas.
