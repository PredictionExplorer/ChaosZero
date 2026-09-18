# Integer product verification

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

Direct token transfers do not change the accounted collateral. Funding checks
the actual received balance delta; payouts check both sent and received deltas.
Token behavior inconsistent with exact CST transfers reverts atomically.

This is an implementation argument, not an external security audit. The tests
cover high-precision reference vectors, powers of two, a boundary regression,
all 256 terminal endings, source consistency, custody and liability invariants,
and full-state execution gas.
