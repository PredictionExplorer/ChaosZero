# Contributing

Use the locked toolchain: Node **22.23.2** (`.node-version`), pnpm **10.32.0**
(`package.json`), Foundry **v1.7.1**, and the Solidity compiler and optimizer
settings in `foundry.toml`. CI pins its third-party actions to immutable commit
IDs. Python **3.10 or newer** is required for the independent mathematical oracle;
it uses only the standard library, and GitHub's Ubuntu runners already provide it.
Install Foundry separately, then run these commands in the repository root:

```sh
pnpm install --frozen-lockfile
pnpm setup:dev
pnpm test:e2e:install
```

Setup initializes the pinned `forge-std` submodule, installs both lockfiles, and
sets this clone's `core.hooksPath` to `.githooks`. It does not change global Git
configuration. After cloning elsewhere, run setup there too. The hook scripts
and `node /absolute/path/to/ChaosZero/scripts/check.mjs <mode>` work from any
working directory.

Run `pnpm dev:local` to launch the local prototype with mock CST. The launcher
starts a disposable chain, deploys the local contracts and starts the frontend.
`pnpm local:smoke` exercises the locally running stack. Neither command is a
production deployment workflow.

## Required local checks

```sh
pnpm check:commit       # same checks as pre-commit, applied to staged files
pnpm check              # full pre-push gate
pnpm check:contracts    # Solidity suites and contract-generated fixture agreement
pnpm check:frontend     # lint, types, coverage, production build and audits
pnpm test:tooling       # regression tests for the gates themselves
pnpm test:math-oracle   # independent oracle rejects deliberately corrupted bounds
pnpm check:log-bounds   # check Solidity output against 170-digit Decimal logarithms
pnpm test:heavy         # long fuzz/invariant campaign, with its seed printed
pnpm test:e2e           # Chromium flows against a fresh local chain and mock CST
```

Pre-commit checks staged whitespace and formatting, then runs every relevant
suite: contract changes require the full default Solidity unit, fuzz, invariant
and adversarial suites; frontend changes require its full lint, typecheck and
test suite. Either also checks the Solidity-generated frontend fixtures. Changes
to shared tooling run both groups. Documentation-only changes run formatting and
the gate regression tests. A partially staged file is rejected because tests
would otherwise exercise a different file from the one being committed; stage
the complete intended version first. Unstaged supporting source files are also
rejected, so an uncommitted helper cannot make a broken staged change pass.

Pre-push runs the full default contract suite, fixture consistency, frontend
lint/typecheck, coverage, production build, local browser flows, and dependency audits. Audit service
failures, all production findings, and high/critical development findings fail the gate; do not bypass hooks to work
around them. Fix the underlying issue and rerun the failed check. Neither hook
commits, stages, pushes, or changes a public chain. Browser checks deploy only to
their disposable local chain.

The actual push hook additionally requires a clean working tree and checks that
every pushed revision is the checked-out commit. This prevents uncommitted fixes
or another checked-out branch from making an unchecked push appear tested.
`pnpm check` runs the same test suites on work in progress without those Git-state
requirements.

Use `forge fmt` for Solidity and `pnpm exec prettier --write <files>` for edited
TypeScript, JavaScript, CSS, JSON, Markdown and workflow files. Prettier checks
changed source files, rather than reformatting the repository's existing legacy
files. Generated ABIs, generated test vectors, lockfiles and vendored sources are
excluded. The full lint, typecheck and test gates always cover the entire
frontend. Set `CHECK_BASE=<commit>` to explicitly choose the formatting comparison
baseline; otherwise it uses the default tracked branch. CI uses the pull request
base or the previous pushed commit.

## Differential fixtures

When contract behavior intentionally changes, regenerate and review the frontend
fixtures in the same change:

```sh
forge script script/GenerateVectors.s.sol --tc GenerateVectors
forge script script/GenerateSharedVectors.s.sol --tc GenerateSharedVectors
pnpm check:vectors
```

The check reruns the generator and compares exact bytes, restoring the original
fixture even if generation fails. It never silently accepts new expectations.
The shared corpus contains the original trade cases plus 631 actual Solidity
logarithm results: exact powers of two, every adjacent valid integer, the known
adversarial boundary, and 256 deterministic pseudorandom samples across 120 bit
widths. After fixture agreement, the gate independently checks each interval with
Python's correctly rounded `Decimal.ln` at 170 digits, using directed arithmetic
to enclose the reference itself. It does not copy the Solidity algorithm or allow
an empirical epsilon. Corruption tests prove that an incorrect lower or upper
endpoint fails the command. These finite regression checks support the documented
rounding argument; they do not replace a proof covering every input.
Avoid editing fixtures while this check runs. Ordinary gates clear the optional
`ARBITRUM_RPC_URL` for deterministic local tests. Run the opt-in live fork test
separately when a release needs deployment compatibility verification:

```sh
ARBITRUM_RPC_URL=<read-only Arbitrum endpoint> forge test --match-contract ForkTest -vv
```

## Extended testing and CI

Pull requests and pushes run all required CI jobs without deployment keys or
write permissions. GitHub's scheduled workflow runs the `heavy` Foundry profile
every day and can also be started manually. Its log records the random seed and
its exact reproduction command. Logs and minimized failure inputs are retained
as workflow artifacts; preserve a failing input as a focused regression test
before fixing the bug. Frontend coverage is saved as a separate CI artifact.
Browser tests use a fresh Chromium context per test and a disposable local chain
on port 8555, with the app on port 3100. Existing servers are not reused. Install
Chromium once with `pnpm test:e2e:install`; CI installs its required system
libraries as well. Traces, screenshots and an HTML report are retained on failures.

Heavy testing supplements the default per-commit campaign; passing tests are not
a proof of economic safety or an external security audit. Release review should
also inspect settlement rules, mint/burn authority, numerical boundaries,
cross-market isolation, and the upstream game integration. The current shared
market prototype is for local chains and mock CST; successful local gates do not
authorize deployment with real CST or use of the mock game adapter on a live chain.
