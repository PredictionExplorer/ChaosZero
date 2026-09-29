# Contributing to Chaos Zero

Thanks for helping. This guide covers everything from a fresh clone to a
merged pull request: setup, the commands, what the git hooks and CI check, how
the tests are layered, and the few workflows that need care (gas snapshots,
differential vectors, coverage, pinned tool versions).

## The one rule: `src/` is deployed

`src/GestureSeriesMarket.sol` is live on Arbitrum One at
[`0xDe5bC71e94B991265B2DfDCE0921245B70c51b4d`](https://arbiscan.io/address/0xDe5bC71e94B991265B2DfDCE0921245B70c51b4d).
It has no owner, no pause and no upgrade path, so it can never be patched in
place. This repository reproduces that deployment byte for byte, CBOR metadata
hash included, and the tests prove it on every run.

- Any change under `src/`, however small (a comment changes the metadata hash),
  means a **new deployment**: a new address, liquidity migrating by hand, and a
  frontend release pointing at it. Open an issue to discuss it before writing
  code.
- The same goes for the compiler settings in `foundry.toml`
  `[profile.default]` (`solc`, `optimizer`, `optimizer_runs`, `via_ir`,
  `evm_version`) and for anything that changes solc metadata, such as the
  pinned `remappings` list: solc records every remapping, even one only tests
  use. A library added for tests is imported by relative path
  (`../lib/<name>/src/...`) instead. New sections and profiles (`[lint]`,
  `[profile.heavy]`, ...) are fine.
- No inline tool pragmas in `src/` either (`slither-disable`,
  `forge-lint: disable`): they are source changes too. Triage findings in the
  tool configs instead.

Everything else (tests, scripts, tooling, CI, docs and the whole frontend)
changes through normal pull requests.

## Set up in one command

```bash
git clone --recurse-submodules https://github.com/PredictionExplorer/ChaosZero
cd ChaosZero
make setup
```

`make setup` initialises the `forge-std` submodule, installs the frontend
dependencies with the locked versions, installs the git hooks and finishes with
`make doctor`, which compares every tool against its pinned version. It is safe
to rerun at any time.

What it expects to find:

| Tool | Version | Install |
|---|---|---|
| Node | 22 ([`.nvmrc`](.nvmrc)) | `nvm install` |
| pnpm | [`packageManager`](frontend/package.json) (10.33.0) | `corepack enable pnpm` |
| Foundry | `FOUNDRY_VERSION` in [`tools/versions.env`](tools/versions.env) | `make foundry` (the pinned release, checksum-verified) or `foundryup --install v1.8.3` |
| solc | `SOLC_VERSION` (0.8.35) | forge downloads it on the first build |

Optional locally, always enforced by CI: gitleaks, typos, actionlint, zizmor,
slither and halmos. `make extras` installs the pinned versions (Go binaries
from checksummed GitHub releases into `~/.local/bin`, Python tools with uv or
pipx). Without them the matching hooks print a one-line notice and move on.

Prefer a ready-made environment? Open the repository in a dev container or
GitHub Codespaces ([`.devcontainer/`](.devcontainer/devcontainer.json)):
Node, pnpm, the pinned Foundry and solc, the scanners, the dependencies and the
hooks are all installed on creation. Claude Code on the web gets the same
toolchain from [`.claude/hooks/session-start.sh`](.claude/hooks/session-start.sh).

## Repository map

| Path | What lives there |
|---|---|
| `src/` | The deployed contract and the game interface it reads. Immutable, see above |
| `test/` | Foundry suites: unit, fuzz, invariant, attacks, events, gas benchmarks, deployment integrity, fork |
| `test/halmos/` | Symbolic tests (halmos) |
| `script/` | `Deploy.s.sol` (production), `DeployLocal.s.sol` (anvil sandbox), `GenerateVectors.s.sol` (differential vectors) |
| `broadcast/` | The recorded Arbitrum One deployment the integrity test checks against |
| `snapshots/` | Committed gas snapshot (`GasBenchmarksTest.json`) |
| `frontend/` | The Next.js app, its unit tests (`src/**/*.test.ts(x)`) and Playwright suite (`e2e/`); see [frontend/README.md](frontend/README.md) |
| `tools/` | `setup.sh` (setup, doctor, pinned installers), `versions.env` (tool pins), `coverage.sh`, `e2e.sh`, `analysis/`, `hooks/` |
| `lefthook.yml` | Git hooks |
| `Makefile` | Every task below |
| `.github/` | CI workflows, Dependabot, CODEOWNERS, issue and PR templates |

## Commands

Run `make` for the full list. The same targets run in the git hooks and in CI.

| Command | Does |
|---|---|
| `make check` | Every offline CI gate in order, stopping at the first failure: `locks-check fmt-check lint typecheck build gas-check test-contracts coverage vectors-check` (`coverage` runs the frontend tests) |
| `make fmt` / `make fmt-check` | `forge fmt` and Prettier, in place or as a check |
| `make lint` | `forge lint` and ESLint, warnings are errors in both |
| `make typecheck` | TypeScript |
| `make build` | `forge build --sizes` (the contracts; `make build-frontend` runs `next build`, which needs network for Google Fonts) |
| `make test` | `forge test` and Vitest |
| `make test-contracts` / `make test-frontend` | One side only |
| `make test-e2e` | Playwright against a local anvil deployment (`tools/e2e.sh` starts and stops everything) |
| `make test-fork` | Fork tests against Arbitrum One; needs `ARBITRUM_RPC_URL` |
| `make test-heavy` | The long fuzzing campaign (`FOUNDRY_PROFILE=heavy`) |
| `make coverage` | Contract and frontend coverage, failing below the thresholds |
| `make gas` / `make gas-check` | Refresh or check the gas snapshot |
| `make vectors` / `make vectors-check` | Regenerate or check the differential vectors |
| `make analyze` | `forge lint`, Slither and halmos (`make slither`, `make halmos`); `make mutation` is the slow weekly one |
| `make dev` | Frontend dev server; see [frontend/README.md](frontend/README.md) for the local anvil sandbox |
| `make doctor` | Tool versions against the pins |
| `make locks` | Regenerate the hash-locked requirements CI installs the Python tools from |

## Git hooks

[lefthook](https://lefthook.dev) runs the hooks in [`lefthook.yml`](lefthook.yml).
They are installed by `make setup` (or `make hooks`) and by `pnpm install` in
`frontend/`; lefthook itself is pinned in `frontend/package.json`. Each hook
exists because CI would reject the same problem later, only slower.

**pre-commit** works on staged files only and takes a couple of seconds:

1. Fixes, in parallel: `forge fmt` on staged `.sol` files, Prettier on staged
   frontend files, then ESLint (`--max-warnings=0`) on the staged TypeScript
   and JavaScript.
   Formatting fixes are re-staged automatically; unstaged edits in the same
   files are set aside and restored untouched.
2. Checks what is actually being committed, in parallel:
   - [`tools/hooks/check-staged.sh`](tools/hooks/check-staged.sh): no
     merge-conflict markers, no file over 1 MB (the lockfile and the vectors
     are allowlisted), and no `.env` files other than
     `frontend/.env.example` and `frontend/.env.production`
   - gitleaks on the staged diff, when installed
   - typos on the staged files, when installed

**pre-push** runs what CI would catch, scoped to what the pushed commits touch:

- contracts changed (`*.sol`, `foundry.toml`, `lib/`, `snapshots/`,
  `broadcast/`, the vectors, `frontend/.env.production`, the `Makefile`,
  `tools/versions.env`):
  `make lint-contracts build gas-check test-contracts vectors-check`
- frontend changed (anything under `frontend/` except Markdown, the
  `Makefile`, `tools/versions.env`): `make lint-frontend typecheck test-frontend`
- neither (docs only): nothing

[`tools/hooks/pre-push.sh`](tools/hooks/pre-push.sh) decides. The pushed
commits are the ones between `HEAD` and what the remote already has
(`@{push}`), or, for a new branch, where it left `origin`'s default branch.
Without any remote-tracking branch, everything is checked.

The checks run against your working tree, so commit or stash unrelated edits
before pushing.

**commit-msg** is deliberately absent. Commit messages here are free-form
prose: say what changed and why, as the history does. No prefixes, no subject
length limit.

Skipping, when you know better:

```bash
LEFTHOOK=0 git commit ...                  # or git commit --no-verify
LEFTHOOK_EXCLUDE=eslint,typos git commit   # skip named jobs only
LEFTHOOK_EXCLUDE=contracts git push        # skip the contract checks on push
```

For permanent personal changes, create `lefthook-local.yml` next to
`lefthook.yml` (it is gitignored and merged over the shared config):

```yaml
pre-push:
  jobs:
    - name: contracts
      skip: true
```

CI runs every check regardless, so skipping a hook only postpones the answer.

**GUI git clients.** Clients that start hooks without your shell profile
(Sourcetree, Tower) would not find Node, pnpm or Foundry. Every hook first
sources [`tools/hooks/env.sh`](tools/hooks/env.sh), which adds the usual
install locations (nvm, fnm, Volta, Homebrew, `~/.foundry/bin`,
`~/.local/bin`) when they exist. For anything else, point `rc:` in your
`lefthook-local.yml` at a script that sets `PATH`.

## Testing layers

| Layer | Where | Run with |
|---|---|---|
| Unit tests for every function and guard | `test/GestureSeriesMarket.t.sol` | `make test-contracts` |
| Property-based fuzzing of the economic invariants | `test/GestureSeriesMarketFuzz.t.sol` | `make test-contracts`, `make test-heavy` |
| Stateful invariant campaigns (`fail_on_revert`) | `test/GestureSeriesMarketInvariant.t.sol` | `make test-contracts` |
| One scripted attacker per mitigation | `test/GestureSeriesMarketHardening.t.sol` | `make test-contracts` |
| Exact event output of every entry point | `test/GestureSeriesMarketEvents.t.sol` | `make test-contracts` |
| The repository still builds the deployed bytecode | `test/DeploymentIntegrity.t.sol` | `make test-contracts` |
| Gas of every state-changing entry point | `test/GasBenchmarks.t.sol` | `make gas-check` |
| Behaviour against the live game | `test/Fork.t.sol` | `make test-fork` |
| Symbolic tests over all inputs | `test/halmos/` | `make halmos` |
| Static analysis | `slither.config.json`, `[lint]` in `foundry.toml` | `make slither`, `make lint` |
| Mutation testing (do the tests notice broken code?) | `tools/analysis/` | `make mutation` (weekly in CI) |
| Frontend unit, property and component tests | `frontend/src/**/*.test.ts(x)` | `make test-frontend` |
| TypeScript math equals the contract, bit for bit | `frontend/src/test/fixtures/contract-vectors.json` | `make test-frontend`, `make vectors-check` |
| The production build against a real local chain | `frontend/e2e/` | `make test-e2e` |

A new contract behaviour gets a unit test and, where it states a property, a
fuzz or invariant test. A new attack surface gets a scripted attacker in the
hardening suite. A new frontend calculation gets a property test and, if it
mirrors contract math, a vector.

## Workflows that need care

### Gas snapshot

`snapshots/GasBenchmarksTest.json` records the gas of every benchmarked call,
and CI fails when it drifts. After a change that moves gas (a test harness
change, or a Foundry upgrade):

```bash
make gas          # rewrite the snapshot
git diff snapshots/
```

Commit the new snapshot and say in the pull request why the numbers moved.
Gas figures depend on the Foundry version, so use the pinned one
(`make doctor`).

### Differential vectors

`script/GenerateVectors.s.sol` runs hundreds of real contract flows and writes
`frontend/src/test/fixtures/contract-vectors.json`, which the frontend math must
reproduce exactly. After changing the script, or anything the vectors exercise:

```bash
make vectors         # regenerate
make test-frontend   # the TypeScript side must still match
```

`make vectors-check` (pre-push and CI) regenerates the file and fails if it
differs from the committed one. The file is generated: never edit it by hand
and never reformat it.

### Coverage

`make coverage` runs `tools/coverage.sh`, which fails when line or function
coverage of `src/` drops below 100% or branch coverage below its documented
floor, and `pnpm test:coverage`, whose thresholds live in
`frontend/vitest.config.mts`. Thresholds only go up.

### Fork tests

`test/Fork.t.sol` checks the integration against the live game. It skips itself
unless `ARBITRUM_RPC_URL` is set:

```bash
ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc make test-fork
```

## Continuous integration

Every push and pull request runs the workflows in
[`.github/workflows/`](.github/workflows): `ci.yml` covers everything
`make check` does plus the frontend production build, the Playwright suite,
the fork tests, slither, halmos, gitleaks, typos, actionlint and zizmor;
`codeql.yml` runs GitHub code scanning; `scorecard.yml` publishes the OpenSSF
Scorecard. `nightly.yml` runs the long fuzz campaign, the fork tests at the
chain head, Halmos and an audit of the production dependencies, and opens
one issue labelled `nightly-failure` when any of them fails. Mutation testing
runs weekly. Dependabot keeps the actions and dependencies current. The
workflow files are the authoritative list of jobs.

GitHub disables the scheduled workflows of a public repository after 60 days
without activity, and the contract never changes, so a quiet repository can
lose its nightly checks just when the live game changes under it. If GitHub
emails that a scheduled workflow was disabled, re-enable it under Actions.

If CI fails and the hooks passed, run `make check` locally first: it is the
same set of commands.

### Repository settings

The workflows rely on a few one-time settings that only a repository admin can
change:

- **Rules** (Settings → Rules → Rulesets), for `main`: require a pull request,
  require the status check `CI OK` with GitHub Actions as its source, and
  block force pushes and deletions. `CI OK` is the only check to require;
  adding a job to CI never needs a settings change. Require an approving
  review only once there is a second maintainer: GitHub never lets authors
  approve their own pull requests.
- **Advanced Security** (Settings → Advanced Security): turn on the dependency
  graph (the `Dependency review` job fails without it), Dependabot alerts and
  security updates, secret scanning with push protection, and private
  vulnerability reporting (the reporting route in [SECURITY.md](SECURITY.md)).
  Leave CodeQL's "default setup" off: `codeql.yml` is the advanced setup, and
  GitHub rejects its uploads while default setup is on.
- **Environments** (Settings → Environments): optionally give the
  `arbitrum-rpc` environment (the first CI run creates it) an
  `ARBITRUM_RPC_URL` secret, so the fork tests use a dedicated RPC instead of
  the public endpoint. Add no protection rules or branch restrictions to it:
  pull requests run the fork tests.
- **General → Pull Requests**: keep merge commits allowed, for changes whose
  individual commits matter (a formatting-only commit listed in
  [`.git-blame-ignore-revs`](.git-blame-ignore-revs) must keep its hash).

## Updating pinned tool versions

Every tool version lives in exactly one place:

| What | Where |
|---|---|
| Foundry, solc, slither, halmos, zizmor, actionlint, typos, gitleaks, lefthook | [`tools/versions.env`](tools/versions.env) (plain `KEY=value` lines, read by make, the scripts and CI); the Python tools' dependencies are locked from it in [`tools/requirements/`](tools/requirements) |
| Node | [`.nvmrc`](.nvmrc) and `engines` in `frontend/package.json` |
| pnpm | `packageManager` in `frontend/package.json` (`corepack use pnpm@<version>`) |
| npm packages | `frontend/package.json` and `frontend/pnpm-lock.yaml` |
| GitHub Actions | the `uses:` references in `.github/workflows/`, bumped by Dependabot |

To move Foundry to a new release, update `FOUNDRY_VERSION` and its four
checksums together (the installer refuses a download that does not match):

```bash
v=v1.9.0   # the new release
for p in linux_amd64 linux_arm64 darwin_amd64 darwin_arm64; do
  printf 'FOUNDRY_SHA256_%s=' "$(printf %s "$p" | tr '[:lower:]' '[:upper:]')"
  curl -fsSL "https://github.com/foundry-rs/foundry/releases/download/$v/foundry_${v}_$p.tar.gz" |
    shasum -a 256 | cut -d ' ' -f 1
done
```

Then `make foundry`, `make gas` (gas figures can move between releases) and
`make check`. The deployment integrity test confirms the new Foundry still
builds the deployed bytecode. `SOLC_VERSION` is different: the compiler is
part of the deployed artifact, so changing it is a redeploy-level change.

To bump lefthook, change `LEFTHOOK_VERSION`, the exact devDependency
(`pnpm add -D -E lefthook@<version>` in `frontend/`) and `min_version` in
`lefthook.yml` together. For gitleaks and actionlint, change the version and
its Linux archive checksum (`GITLEAKS_SHA256_LINUX_X64`,
`ACTIONLINT_SHA256_LINUX_AMD64`, from the release's checksums file) in
`tools/versions.env`. CI installs the Python tools (Slither,
crytic-compile, Halmos, zizmor, typos) from hash-locked requirements with
every dependency pinned, so after changing one of their versions run
`make locks` (needs [uv](https://docs.astral.sh/uv)), which regenerates
[`tools/requirements/`](tools/requirements); CI fails when a lock and
`tools/versions.env` disagree. Rerun it now and then to take dependency
fixes.

## Pull requests

1. Branch from `main`. Keep each pull request to one purpose.
2. Run `make check` (the hooks already ran most of it).
3. Fill in the [pull request template](.github/pull_request_template.md): what
   and why, how you tested, and the checklist, including the `src/` rule.
4. CI must be green (`CI OK`). The code owners
   ([CODEOWNERS](.github/CODEOWNERS)) are asked for review automatically.

Write commit messages as prose that explains why the change is right; reviewers
and future readers depend on them.

## Reporting security issues

Never in a public issue or pull request. See [SECURITY.md](SECURITY.md).
