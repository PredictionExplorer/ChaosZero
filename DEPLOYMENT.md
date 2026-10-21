# Arbitrum deployment

The deployment commands are prepared for an operator to run later. Developing or
testing these commands does not authorize a public deployment. The automated
integration test uses an in-process chain with ID 31337 and never broadcasts to
Arbitrum.

## Prepare and review

Use the pinned Node/pnpm versions in `CONTRIBUTING.md`, initialize the pinned
submodules, and install with `pnpm install --frozen-lockfile`. Run the repository
checks, including `pnpm test:deployment`, before release. Hardhat 3 builds with
Solidity 0.8.35, one million optimizer runs, viaIR, and Osaka, matching the
Foundry production settings. Its artifacts live under `.local/hardhat-artifacts/`.
Run `pnpm build:deployment` separately to inspect any compiler diagnostics.

Review `deployment/arbitrum-round-2-baseline.json` and its provenance before
deployment. The source constructor freezes those historical values for cycle 2,
so cycle 3 can compare with its predecessor. This is a public, independently
checkable deployment input; the adapter does not verify historical receipt proofs
on chain. Later cycles read the game's permanent V3 records. The script accepts
only the reviewed file and its fixed first market cycle, with no prompt to replace
the historical values. It checks the game's stored predecessor count before
deploying. Incorrect constructor values cannot be repaired on the deployed source.

The reviewed cycle-2 values are:

| Statistic                  | Exact value                    |
| -------------------------- | ------------------------------ |
| Gestures                   | 1,257                          |
| ETH paid                   | 17.785933723725359657 ETH      |
| CST paid                   | 118,887.756299069655832122 CST |
| Highest single CST payment | 469.235819458920479966 CST     |
| Endurance duration         | 17,766 seconds                 |
| Chrono duration            | 783,402 seconds                |
| Same individual gesture    | No                             |

Both champion recipients use the same wallet, but their individual gestures are
1,184 and 971 (one-based), so the final answer to the same-gesture question is NO.
The constructor commitment is
`0x270bdafae80631bde00ccdad3a78ca455a073a900c3d91fb7ead3d0b870f5891`.
The deployment launcher recomputes and pins this commitment before requesting
credentials; changing a value in the evidence JSON cannot silently change the
deployed baseline.

Reproduce the evidence using public, read-only RPC calls:

```sh
pnpm verify:baseline
pnpm verify:baseline --refresh
pnpm verify:baseline --offline
```

The first command downloads any missing public data into `.local/historical/`
and compares the reconstruction with the reviewed JSON. `--refresh` re-fetches
all history; `--offline` replays the existing cache without network access. The
verifier compares the complete gesture count and per-wallet payments/timestamps
with permanent game storage, checks each log's block hash against headers from
a second public provider, and matches every log with a successful receipt from
a third provider. Champion durations come from an independent record-episode
replay, including strict ties and the actual claim timestamp; recipient events
provide a separate wallet cross-check. The commitments describe exactly the
canonicalized public inputs. This remains off-chain verification, not an on-chain
receipt proof or an independent consensus client.

`--write-evidence` is the explicit maintenance option that regenerates the JSON
after all checks pass. Preserve the exact reviewed evidence file once deployed:
the public transaction manifest binds to its complete file hash, including its
verification block and provenance. Normal verification does not rewrite it.

The production command pins Arbitrum One (42161), the game proxy
`0x6a714Ae7B5b6eA520F6BCA23d2E609C4Fd5863F2`, and CST
`0xAD91843e6A58Ba560F577E676986AFb1dba6FBA0`. It checks chain ID, contract code,
the game's CST address, and the V3 statistics ABI before asking for a signing key.
The proxy's EIP-1967 implementation slot must name the reviewed V3 implementation
`0xc1b97E1b0baC86248653B18706dbC5c8898c5c06`. The check runs before signing-key
prompts and again after confirmation and gas estimation, immediately before
signing a new source deployment. A changed implementation stops the command;
only explicit chain-31337 integration tests skip this production pin. This is a
preflight check, not a restriction on future upgrades to the game proxy.

## Deploy and verify

Run from an ordinary interactive terminal:

```sh
cd /Users/tarasbobrovytsky/Dev/ChaosZero
pnpm deploy:arbitrum
```

The signing wallet needs ETH **on Arbitrum One** for deployment gas. The local
Anvil wallets and test CST do not fund a public deployment. Do not append keys to
this command or redirect it through a terminal-recording tool. Enter secrets only
at the hidden prompts; no characters, including masking dots, are echoed.

The script compiles before requesting credentials, then prompts for:

1. The Arbitrum HTTPS RPC endpoint; Enter selects the public endpoint.
2. The deployment private key.
3. A maximum **total** gas budget in ETH, covering both deployment transactions.
4. The exact confirmation `DEPLOY ARBITRUM` after displaying the chain, contract
   addresses, deployer, first cycle, evidence hash and gas budget.
5. An **Etherscan V2** API key for automatic Arbiscan verification after deployment.

All input is hidden, including the endpoint because it may contain an API token.
Use an Etherscan V2 key that supports Arbitrum One; a legacy Arbiscan-only key is
not interchangeable. Only the operator's local terminal should receive keys.
Never paste keys into chat, command arguments, environment variables, configuration
files, manifests or support logs. Piped input is rejected. Debuggers, diagnostic
reports, profiling and injected Node startup modules are rejected before prompts.

The signing key stays inside an in-memory ethers Wallet. Hardhat receives only
the in-memory RPC endpoint and explorer API key. Dependencies' stdout/stderr are
suppressed, and failures print fixed messages without raw errors, stacks, request
bodies or URLs. No credential is written by the script. JavaScript strings cannot
be reliably zeroed in memory; this is not protection against a compromised host,
memory dumps or an external terminal recorder.

The script deploys `V3OutcomeSource` and `IndependentOutcomeMarket`. The market
constructor creates `OutcomeSettlementVault` and `IndependentMarketViews`.
All four contracts are submitted for verification using the same production
compiler profile. No CST is approved or transferred, and no market is funded by
this command. Initial funding is a separate transaction and an irreversible
contribution under the market's existing rules.

## Public receipts and recovery

The default manifest is `.local/arbitrum-deployment.json`. A custom public JSON
path may be supplied as the final argument to any command. Retain this file and
the matching source revision/artifacts. It contains only public chain/contract
addresses, baseline values and evidence hash, compiler bytecode hashes, deployer,
gas budget, signed-transaction hashes/nonces, and verification status. It contains
no RPC URLs, API keys, signing keys, signed transaction bodies or error payloads.

Each predicted address, nonce and transaction hash is saved **before** broadcast.
The signed transaction stays in memory. After an interruption, inspect the public
hash on Arbiscan before continuing:

```sh
pnpm deploy:resume
```

Resume validates existing transactions against the exact local creation bytecode
and constructor arguments. Confirmed contracts are reused and only missing
deployment transactions are sent. The resume command requests the signing key
and explicit confirmation even if both transactions already exist; use
`pnpm verify:arbitrum` instead when deployment is complete and only verification
remains, so no signing key is requested. A journaled hash
with no receipt is ambiguous: the script stops and never automatically resends or
replaces it. A reverted transaction also stops. Resolve a dropped or reverted
transaction explicitly before choosing a new deployment; never delete the journal
merely to bypass these checks. The original total gas budget remains in force.

If deployment succeeded but explorer verification failed, use:

```sh
pnpm verify:arbitrum
```

This mode requests only the hidden RPC and explorer inputs. It does not request a
private key, construct a signer or send transactions. It rechecks all four contracts
with the explorer even when a previous run marked them verified. A successful
deployment with delayed explorer indexing can therefore be verified later without
deploying twice.

The `.lock` file prevents simultaneous deployments to the same manifest. Ctrl-C
restores terminal input and releases that lock. A hard kill or machine crash can
leave a stale `.lock` or public `.next` journal; first ensure no deployment process
is running, then inspect both public journal files and transaction hashes before
removing a stale lock or promoting the newest complete receipt. The script stops
on journal write failures and does not continue broadcasting.

After verification, the manifest supplies the market, source and vault addresses
for the production frontend configuration. Check that the frontend reads this
market and the real CST token before enabling it. This release uses only the new
eight-question market; it does not migrate or expose the legacy market.

## Claims after game closure

Once the game's successful `claimMainPrize` transaction advances `roundNum`,
holders can submit `claimKnown` immediately. The first claim performs any required
settlement itself, reserves every winning holder's collateral, and pays the
caller in the same transaction. No separate administrator, keeper, oracle update,
next-cycle funding or waiting period is required. An expired countdown alone is
not game closure. Payouts are user-initiated transactions, not automatic transfers.

The frontend follows the new current cycle after closure. Select **Previous
cycle** (or `/?round=3` for the first production market) and **Retrieve winnings**.
The independent market refreshes every four seconds, subject to RPC availability.
Its separate **Settle this cycle** button is optional before claiming.

## Tooling validation

`pnpm test:deployment` covers raw-terminal no-echo behavior, cancellation and
terminal restoration, rejection of piped credentials/debug runtimes, suppression
of hostile error payloads, manifest allowlisting, chain/address/baseline checks,
gas-budget enforcement, failure before broadcast, ambiguous transaction recovery,
repeat verification, and a complete local deployment/resume without extra
transactions. The local test uses real production bytecode and a minimal test
game. Explorer calls are replaced with a local test callback: successful real
Arbiscan verification still has to be confirmed when the operator deploys.

The integration follows Hardhat's
[programmatic verification API](https://hardhat.org/docs/plugins/hardhat-verify#programmatic-verification),
[production build profiles](https://hardhat.org/docs/plugins/hardhat-verify#build-profiles-and-verification),
and [Foundry remapping support](https://hardhat.org/docs/reference/foundry-compatibility#remappings).
