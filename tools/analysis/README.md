# Contract analysis: Slither, forge lint, Halmos, mutation testing

Four independent checks on the market contract, each answering a different
question:

| Check | Question it answers | Command | CI | Gate |
| --- | --- | --- | --- | --- |
| Slither | Does the code match a known bug pattern? | `tools/analysis/slither.sh` | every push / PR, SARIF to code scanning | any finding not in `slither.db.json` |
| forge lint | Does new Solidity code follow Foundry's lints? | `forge lint --deny warnings` | every push / PR | any warning |
| Halmos | Do the key properties hold for **all** inputs? | `tools/analysis/halmos.sh` | every push / PR | any counterexample, error or timeout |
| Mutation testing | Would the test suite notice a bug? | `tools/analysis/mutation.sh` | weekly schedule | report only (optional threshold) |

Pinned versions (`tools/versions.env`; the scripts warn locally and fail in
CI on a mismatch): Foundry 1.8.3, Slither 0.11.6 (crytic-compile 0.4.2),
Halmos 0.3.3. Reports go to `.analysis/` (gitignored).

## Why nothing is suppressed in `src/`

`GestureSeriesMarket` is deployed on Arbitrum One at
`0xDe5bC71e94B991265B2DfDCE0921245B70c51b4d`, and compiling `src/` with the
default profile reproduces the deployment transaction byte for byte,
including the CBOR metadata hash, which covers the source text. A
`// slither-disable-next-line` or `// forge-lint: disable-next-line` comment
in `src/` would change that hash, so every suppression lives outside the
source: a per-finding triage database for Slither, the `[lint]` section of
`foundry.toml` for forge lint. None of the tools below changes compiler
settings of the default profile; they add their own profiles.

## Slither

```sh
tools/analysis/slither.sh                     # what CI runs
slither . --config-file slither.config.json  # same analysis; see the note below
```

`slither.config.json` compiles with Foundry (crytic-compile builds `src/`
only, with the production compiler settings), runs all detectors at every
severity, and hides findings through the triage database `slither.db.json`.
Slither exits non-zero on any remaining finding (its default "pedantic"
fail level). The wrapper adds three things: it points crytic-compile's
`forge clean` + `forge build --force` at `.analysis/slither/` so a local run
does not wipe your `out/` and `cache/`, it checks the Slither version, and it
writes `.analysis/slither/slither.sarif` for GitHub code scanning (triaged
findings are not in it) plus `slither.json`.

### How triage works, and why it is per finding

Each entry in `slither.db.json` holds one finding's `id`: a SHA3 of the
finding's full description, which names the exact functions, statements and
source lines involved. Slither drops a result only when its id (or its
identical description) is in the database, so:

- a new instance of an already-triaged detector class (another reentrancy,
  another uninitialized local) has a different id and still fails;
- ids use repository-relative paths, so they are identical on every checkout
  (verified by running from a copy at a different absolute path);
- ids change when the source lines or Slither's wording change. `src/` is
  frozen and Slither is pinned; after a Slither upgrade, re-triage (below).

Verified gate behavior: with the database the run exits 0 and the SARIF has
0 results; with the `uninitialized-local` entry removed it exits 255 and the
SARIF holds exactly that finding at `src/GestureSeriesMarket.sol:418`;
with a new unguarded local and a new pull-then-write function appended to a
scratch copy of the contract it exits 255 on exactly those two new findings
while the eight triaged ones stay hidden. `--show-ignored-findings` prints the
triaged findings.

`filter_paths` patterns are anchored on file suffixes (`\.t\.sol$`,
`\.s\.sol$`, `(^|/)test/utils/`, `(^|/)lib/forge-std/`) on purpose: Slither
matches them against absolute paths, so a plain `lib/` or `test/` would hide
every finding for anyone whose checkout lives under a directory of that name.
For the same reason `exclude_dependencies` is off (crytic-compile flags any
path containing a `lib` directory as a dependency).

### Triaged findings

Slither 0.11.6 reports eight results on `src/`. None is a real
vulnerability.

| # | Detector (impact / confidence) | Location | Verdict | Reasoning |
| - | --- | --- | --- | --- |
| 1 | `reentrancy-no-eth` (Medium / Medium) | `addLiquidity` → `_openPool`, L254 → L604-605 | false positive | The flagged call is `cst.transferFrom` pulling the caller's own CST before crediting them (pull-then-credit, the safe order). Every state-mutating entry point shares one contract-wide `nonReentrant` lock, so a token callback cannot re-enter anything that writes `_rounds`, even with a hostile token; in production the token is the immutable CST address read from the game at construction. The cross-function list contains only `view` functions, and before the pull the only writes are the idempotent round initialization and threshold lock, so a read-only-reentrant observer sees a consistent pre-deposit snapshot. |
| 2 | `reentrancy-no-eth` (Medium / Medium) | `addLiquidity` → `_joinPool`, L254 → L643-644 | false positive | As #1. The second external call on this path, the pending-fee payout in `_joinPool` (L654), is the function's last action, after every write. |
| 3 | `reentrancy-no-eth` (Medium / Medium) | `mintSets`, L342 → L343-344 | false positive | As #1: pull of the caller's own CST, then credit, under the contract-wide lock. |
| 4 | `divide-before-multiply` (Medium / Medium) | `_bet`, L670 and L673 | false positive (intentional) | `fee` is the integer CST amount actually retained in `feeReserve`, so `accFeePerShare` must distribute exactly that floored amount. Fusing the expressions would credit LPs with fees the pool never retained and break `sum(pendingFees) <= feeReserve`. Both floors favor the contract; the dust stays in `feeReserve`. Pinned by `invariant_shareAndFeeAccountingCoherent`, `invariant_exactCollateralization` and `testFuzz_feeEscrowExactUnderChangingVotes`; the Halmos property `check_bet_exactCollateralization` proves the escrow equals the floored fee for every bet. |
| 5 | `uninitialized-local` (Medium / Medium) | `resolve`, `yesWon_` at L418 | false positive | Assigned on both non-reverting branches (round over: `count > threshold`; live round: `true`); the only other branch reverts with `NotResolvable()`. The detector does not treat the custom-error `revert` as ending the path. Proven by `check_resolve_*`. |
| 6 | `shadowing-local` (Low / High) | `ICosmicSignatureGame.bidderAddresses(uint256 roundNum)`, L16 | false positive | A parameter name in a body-less interface declaration, mirroring the upstream game's getter; there is no scope in which the shadowed `roundNum()` could be referenced. |
| 7 | `timestamp` (Low / Medium) | `_checkDeadline`, L736 | accepted (intended use) | The user-signed `deadline` guard, Uniswap style. Sequencer timestamp drift can only move a transaction's expiry edge by the drift the chain allows; no value depends on the timestamp, and every trade is also bounded by explicit slippage minimums, which are the economic protection. |
| 8 | `pragma` (Informational / High) | `GestureSeriesMarket.sol` L2 (`0.8.35`) vs `ICosmicSignatureGame.sol` L2 (`^0.8.35`) | false positive | The contract pins `0.8.35` for a reproducible, verified deployment; the interface floats so integrators can import it with newer compilers. Both compile with the pinned solc 0.8.35. |

The same rationale is stored with each entry in `slither.db.json`.

### Handling a new finding

1. Run `tools/analysis/slither.sh` and read the finding. A real issue is
   fixed (which, for the deployed contract, means a new deployment), never
   triaged.
2. For a false positive, copy the finding's `id`, `check`, `impact`,
   `confidence`, `first_markdown_element` (as `location`) and `description`
   from `.analysis/slither/slither.json` into a new `slither.db.json` entry,
   add `verdict` and `rationale`, and add a row to the table above.
3. After a Slither upgrade that rewords descriptions, every id changes at
   once: re-run with `--show-ignored-findings`, confirm the findings are the
   same eight, and regenerate the ids.

## forge lint

```sh
forge lint --deny warnings    # the gate: CI, pre-commit, make lint
```

`foundry.toml` `[lint]`:

- `severity = ["high", "med", "low"]` (Foundry's default, stated
  explicitly). `info` and `gas` lints on the deployed contract (immutable
  naming, multi-contract file, modifier wrapping) would ask for source
  changes that are impossible without a redeployment.
- `exclude_lints = ["reentrancy-no-eth", "reentrancy-events",
  "divide-before-multiply"]`. These are Foundry's ports of three Slither
  detectors, and on `src/` they produce eleven warnings, all false
  positives: the ten reentrancy ones because the port does not model the
  contract-wide `nonReentrant` lock (its message is literally "can be
  reentered before `_lock` is updated"), the division one for the reason
  in finding #4. Nothing is lost: Slither runs the original detectors over
  `src/`, models the lock (which is why it reports no `reentrancy-events`),
  and triages per finding, so a new instance of these classes still fails
  CI. The alternative, `ignore = ["src/GestureSeriesMarket.sol"]`, would
  switch off every other lint on the one file that matters most.
- `lint_on_build = false`. Lint is its own gate; builds for tests, coverage,
  Slither, Halmos and mutation runs stay quiet, and lint-on-build only sees
  files that were recompiled, which makes its output depend on cache state.

With this configuration `forge lint` reports nothing on `src/` and
`script/`. The only remaining warning is in a test file
(`environment-read-across-mutation` at
`test/GestureSeriesMarketHardening.t.sol:163`), which the test-suite owners
fix in the test itself. Foundry 1.8.3's closing line ("aborting due to 12
linter warning(s)") also counts the excluded diagnostics; the exit status
and the printed warnings are what matter.

## Halmos

```sh
tools/analysis/halmos.sh                         # all properties
tools/analysis/halmos.sh --function check_bet    # one property
```

`test/halmos/GestureSeriesMarketSymbolic.t.sol` holds `check_*` functions.
Every argument is symbolic, so Halmos proves each assertion for every value
within the stated bounds instead of sampling. A reverting path is not a
failure in Halmos, so each step whose success is part of a property is
asserted explicitly. `forge test` never runs them (no `test` prefix) but
compiles them, so they cannot rot.

The `halmos` profile narrows the test directory to `test/halmos/`, builds
into `.analysis/halmos/`, and inherits the production compiler settings, so
the proofs are about the deployed bytecode. It also
turns off Foundry's dynamic test linking, which would otherwise compile
`new GestureSeriesMarket(...)` in a test into a `vm.deployCode` cheatcode
that Halmos does not support. The wrapper builds from scratch each time
(about 25 s; Halmos would otherwise also run the artifacts of deleted test
files), fails on any counterexample, solver timeout, error, or proof cut
short by a loop bound, and writes `.analysis/halmos/summary.md` (also to
the GitHub job summary), `results.json` and `halmos.log`.
`tools/analysis/halmos.toml` selects the suites and raises the per-query
solver timeout from 60 s to 300 s: the hardest fee-vote query takes 30-45 s
here, and a timeout fails the gate rather than passing silently.

### Properties

Measured with Halmos 0.3.3 and yices on a shared 4-CPU machine: the whole
run takes about 75 s, of which 25 s is the build.

| Property | What is proven | Symbolic inputs | Time |
| --- | --- | --- | ---: |
| `check_completeSets_exactCollateralization` | Minting sets moves exactly `amount` CST and credits exactly `amount` YES and NO; redeeming succeeds exactly when the holder has the pair (`0 < redeem <= amount`) and reverses it exactly; the pool is never touched. | `amount` (1 to 2^96), `redeemAmount` (any) | 1 s |
| `check_resolve_yesIffFinalCountExceedsThreshold` | Once the game has moved past the round, `resolve` always succeeds and YES wins if and only if the final count is strictly greater than the threshold (a tie is NO). | threshold, final count (both any uint256) | 0.1 s |
| `check_resolve_earlyOnlyOnceYesIsCertain` | During the round, `resolve` succeeds exactly when the live count already exceeds the threshold and then always resolves YES; at the same moment betting halts on both sides. | threshold, live count (any), side | 1 s |
| `check_feeVote_ledgerExactAndAverageWithinDeclarations` | Through open, join and re-declaration: total shares are exactly the sum of positions (dead shares included), the fee weight is exactly the sum of shares times declarations (the dead shares keep the opener's first vote), the pool fee is the floored weighted average, and it lies between the smallest and largest declaration, so never above the 10% cap. | all three fee votes (0 to 1000 bps each); the joiner's deposit is 1 wei, 1 CST or 2^96 wei | 46 s |
| `check_bet_exactCollateralization` | Every bet that goes through, on either side: CST held equals outstanding complete sets plus the fee escrow, YES supply equals NO supply equals outstanding sets, the escrow is exactly `floor(cstIn * fee / 10000)`, and the pool absorbs the whole net stake on the side the bettor sold. | `cstIn` (1 to 2^96), fee vote (0 to 1000 bps), side | 1.5 s |

The bet property holds for every bet that succeeds; that bets do succeed on
these paths was checked by inverting it (assert that the bet reverts),
which gave counterexamples on both sides.

### Bounds

Symbolic CST amounts are capped at 2^96 wei (about 79 billion CST, far
beyond any realistic position) to keep the solver's bit-vector arithmetic
tractable; fee votes range over their full legal domain of 0-1000 bps;
thresholds and gesture counts are unbounded. The pool is always opened with
10,000 CST at even odds. In the fee-vote property the join deposit is one
of three sizes, chosen by a symbolic selector (the smallest possible
deposit, one share; 1 CST; the 2^96 bound) while all three votes stay
symbolic: with a symbolic deposit the solver faces products of two
symbolic 256-bit values (shares times votes) next to the join's divisions,
and the same assertions did not finish in 5 minutes.

### What is not proven here, and why

Halmos (like every SMT-based tool) stalls on 256-bit division when the
divisor, or a large product being divided, is symbolic. None of the
following finished within the solver timeout with Halmos 0.3.3 and yices;
the AMM math was also tried with bitwuzla, bitwuzla's abstraction mode, z3
and `forge test --symbolic`, with the same result:

- **The constant-product buy** (`_buyAmount`, which divides by
  `reserveIn + net`) and `_ceilDiv`: "the bettor gets at least their net
  stake", "the pool never releases its last token", "x * y never
  decreases", and so also "a bet succeeds". Small-scope versions do finish
  (`_ceilDiv` on 8-bit operands in 5 s; `_buyAmount` with an 8-bit stake
  against 10,000-CST reserves in 1.5 s), but every 16-bit variant timed
  out, and ranges that small are covered exhaustively by fuzzing, so they
  are not kept.
- **LP fee claims fit in the escrow** (`sum(pendingFees) <= feeReserve`
  after a bet). Even with the bet amount fixed and only the fee vote and
  side symbolic, each of three bet sizes had a query over 60 s; with a
  300 s timeout, four bet sizes took 194 s, too slow and too close to the
  limit for a per-push gate.
- **The fee ledger for a symbolic join deposit** (see Bounds).

These are covered by the Foundry suite over far larger ranges instead:
`testFuzz_buyAmountSafety` and `testFuzz_buyAmountMonotoneInInput`
(reserves and stakes up to 10^33 wei), `testFuzz_feeEscrowExactUnderChangingVotes`,
`testFuzz_feeLedgerMatchesNaiveRecomputation`,
`testFuzz_feeAverageBoundedByDeclarations`, and the invariants
`invariant_exactCollateralization`, `invariant_feeVoteLedgerExact`,
`invariant_shareAndFeeAccountingCoherent` and
`invariant_fundedPoolsNeverDrainWhileLive`.

## Mutation testing

```sh
tools/analysis/mutation.sh                  # full campaign
MUTATION_JOBS=2 tools/analysis/mutation.sh  # fewer parallel mutants
```

The campaign mutates `src/GestureSeriesMarket.sol` and runs the Foundry
suite against every mutant. It is a weekly job, not a PR gate: it takes
up to about two hours, and its output is a to-do list for the test suite
rather than a pass/fail signal.

Runtime. Foundry generates 1,328 mutants of the contract. A time-boxed
sample with this configuration (4 jobs on a shared 4-CPU machine) reached
mutant 70 in 6 minutes, build included, which projects to about 1.9 hours
for the whole campaign; the real figure is lower, because Foundry skips
the remaining mutants of any expression that already has a survivor. The
CI job therefore runs on a 4-core runner with a 180-minute timeout; on a
2-core runner, expect roughly twice as long and raise the timeout.

How it runs:

- **Never touches the checkout.** The script copies the project
  (`foundry.toml`, `src`, `test`, `script`, `lib`) into a temporary
  directory, runs Foundry there, removes the copy on exit (also on Ctrl-C or
  a cancelled job) and fails if `src/` changed. Foundry itself tests each
  mutant in a separate per-mutant workspace inside that copy.
- **Fast profile.** `FOUNDRY_PROFILE=mutation` compiles with legacy codegen
  and no optimizer (about 2 s per mutant instead of about 55 s under
  via-IR; the whole suite compiles and passes that way). Test strength is
  unchanged: the profile inherits the default 1000 fuzz runs and the 64 x 64
  invariant campaign. It fixes the fuzz seed, so the set of survivors is
  reproducible, and disables invariant shrinking, which only minimizes a
  counterexample nobody reads.
- **Fail fast.** `--fail-fast` stops a mutant's test run at the first
  failing test. A killed mutant then costs well under a second of testing
  instead of up to 15 s (measured: a broken invariant spends ~15 s
  shrinking otherwise). Survivors still run the full suite.
- **Excluded suites:** `Fork` (needs an RPC, and the fork runs deployed
  bytecode, not the mutant) and `GasBenchmarks` (gas numbers, not
  behavior). Override with `MUTATION_EXCLUDE`.
- **Per-mutant timeout** of 120 s (`MUTATION_TIMEOUT`), about 20 times a
  normal mutant, so a mutant that makes a campaign pathologically slow is
  recorded as timed out instead of stalling the job.

Output, in `.analysis/mutation/` (gitignored): `summary.md` (printed, and
appended to the GitHub job summary): counts and every surviving mutant as a
diff against its source line; `surviving-expressions.txt`, one line per
source expression with a surviving mutant; `results.json`, Foundry's raw
report; `forge.log`.

Reading the result. A surviving mutant is a change to the contract that no
test notices: either a missing assertion (write the test) or an equivalent
mutant that cannot change behavior (for example `_lock != 1` to
`_lock > 1`, since the lock only ever holds 1 or 2). Foundry skips the
remaining mutants of an expression once one survives, so how many mutants
get tested, and therefore the percentage score, varies a little with
scheduling; the set of expressions with a survivor does not, which is why
the report leads with it. `MUTATION_MAX_SURVIVING_EXPRESSIONS=<n>` turns
that number into a gate once a baseline exists.

### Why Foundry's built-in engine

| | `forge test --mutate` (Foundry 1.8.3) | `slither-mutate` (Slither 0.11.6) | Gambit (Certora) |
| --- | --- | --- | --- |
| Extra install | none, same pinned Foundry | none, same pinned Slither | a separate binary, plus a standalone `solc` on `PATH` |
| Source safety | each mutant in its own workspace; sources never written | writes each mutant over the real file and restores it from a backup | writes mutants to a separate directory; the runner is ours |
| Parallelism | built in (`--mutation-jobs`) | none: one mutant at a time | up to our runner |
| Per-mutant timeout | built in | built in | up to our runner |
| Redundancy pruning | skips the rest of an expression once one of its mutants survives | runs "severe" mutants first and skips minor ones on lines where a severe one survived | none |
| Report | text or JSON: counts plus every survivor with line, column, original and mutant | text log and per-mutant patch files | mutant files and a summary |

Foundry's engine is the only one that is parallel and never writes to the
source file, and it adds no tool to pin. Two caveats, both verified with
1.8.3: the score depends on scheduling (handled above), and the
`[mutation] include_operators` / `exclude_operators` settings are accepted
but not applied by `--mutate` (a probe contract produced the same 37
mutants either way), so the campaign cannot be narrowed by operator.
Slither-mutate would take several hours sequentially; Gambit would need a
hand-written parallel runner and another pinned binary.
