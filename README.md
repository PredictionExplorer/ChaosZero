# Chaos Zero

Eight recurring questions about Cosmic Signature, priced by one fully collateralized CST pool per cycle.

**This branch is a local prototype.** It includes a working shared market, fake CST, an on-chain game simulator, a browser interface, and extensive financial/property tests. No live eight-question result adapter is shipped. The simulator and its outcome adapter reject deployment on chains other than `31337`; the shared frontend rejects public-chain use. The existing production binary market and its configuration remain available, with their documentation in [LEGACY_MARKET.md](LEGACY_MARKET.md).

## Run the complete local system

Requirements: Foundry `v1.7.1` (`forge` and `anvil`), pnpm `10.32.0`, and Node 22.23.2 or a supported Node 24 release. CI pins Node 22.23.2.

```sh
pnpm setup:dev
pnpm dev:local
```

Open <http://127.0.0.1:3000/shared>. Connect a local test wallet and use **Get 1,000 test CST**. Buy or sell positions, split CST into complete YES/NO pairs, merge matching pairs back into CST, or transfer positions to another wallet. You can also make an irreversible gift to the pool, place simulated game gestures, advance local time, retrieve known winning positions, close a cycle, and roll the unused pool funding forward. Three disposable test wallets let you exercise transfers and redemption by the recipient.

The launcher starts a fresh Anvil chain, deploys fake CST and the local game, deploys the shared market, contributes 10,000 fake CST, and starts Next.js with the matching addresses. It uses only Anvil's public unlocked accounts; it never needs a private key. Stop it with Ctrl+C. All development funds are disposable.

The default ports are 3000 for the website and 8545 for Anvil. Override them without editing files:

```sh
PORT=3100 ANVIL_PORT=8555 pnpm dev:local
```

The launcher refuses occupied ports instead of attaching to an unrelated process. Deployment details are written to the ignored `.local/shared-deployment.json`. With the local system running, `pnpm local:smoke` executes the real frontend quote code against the deployed contracts, then restores an Anvil snapshot.

## The eight fixed questions

Every comparison uses the preceding finalized cycle. Strict-comparison ties resolve NO.

| ID  | Question                                         | Result                                                                                                   |
| --- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| 0   | More gestures than the previous cycle?           | Total ETH and CST gesture count is greater.                                                              |
| 1   | Longer Endurance Champion time?                  | Maximum uninterrupted duration is greater.                                                               |
| 2   | Longer Chrono Warrior time?                      | Maximum tenure of an Endurance record is greater.                                                        |
| 3   | More ETH spent on gestures?                      | Actual ETH gesture payments are greater; separate contributions are excluded.                            |
| 4   | More CST burned through gestures?                | CST gesture payments are greater; unrelated token burns are excluded.                                    |
| 5   | More CST gestures than ETH gestures?             | CST count strictly exceeds ETH count within this cycle.                                                  |
| 6   | Does the same gesture earn Endurance and Chrono? | The two winning record episodes originate from the same gesture. Matching wallets alone is insufficient. |
| 7   | Higher maximum CST payment?                      | The largest CST amount actually paid for one gesture is greater.                                         |

Questions 0–4 and 7 can become permanently YES before closure. Questions 5 and 6 remain undecided until closure. The source checks live timing metrics, so the passage of time can establish a known result even without another gesture.

## Funding and ownership

`SharedOutcomeMarket` does not mint CST. Any account may call `fundRound` to contribute existing CST. Contributions are **irreversible gifts**, with no LP shares, fees, refund rights, or sponsor withdrawal authority. Additional gifts increase backing and can move quoted probabilities toward even odds.

There is no market owner, upgrade mechanism, or administrator that can choose results. The token and result-source addresses are immutable. The correctness of the result source remains part of the system's trust model.

After finalization, anyone may call `rollover` to move only the sponsor's remaining capital into a later open cycle. All unpaid winning claims remain reserved in the original cycle. Direct token transfers to the market are deliberately excluded from accounting; use the funding method rather than sending CST directly.

## Complete sets and transferable positions

One CST splits into one YES unit and one NO unit for **one question in one cycle**. A matching pair merges back into exactly one CST, without a fee or price change. Splitting and merging change collateral and the corresponding liabilities equally, leaving every virtual AMM reserve unchanged. YES from one question cannot be paired with NO from another question or cycle.

Splitting requires an open cycle and an unresolved question. It works before sponsorship, but does not fund the AMM: a pool containing only split collateral has no trading reserve. Complete sets can still be merged or settled if no sponsor ever funds that cycle. Merging is available after closure, after finalization, and after unused sponsor funds roll forward. It deliberately makes no call to the result source, so matched pairs remain redeemable if that source becomes unavailable. A known-answer retrieval burns the caller's positions on the resolved questions; those burned units cannot also be merged.

Once the market has successfully observed finalization through retrieval or rollover, `claimKnown` pays according to those permanently cached answers without another source call. This also covers winning positions transferred after finalization. Before finalization is cached, retrieval still requires a fresh, consistent source response. The recovery screen currently exposes source-independent merges and transfers; cached-finalization retrieval is also available directly through the contract.

Positions implement ERC-1155 using pinned OpenZeppelin Contracts. Standard `balanceOf`, `balanceOfBatch`, safe single/batch transfers, operator approvals, ERC-165 discovery, and on-chain metadata are available. An approved operator can transfer **all** of an owner's position types, including positions acquired later, until approval is revoked. The web interface sends owner-authorized transfers and requires no operator approval. Smart-contract recipients must implement ERC-1155 acceptance callbacks.

The position ID is `(cycle << 4) | (question << 1) | side`, where question IDs are 0–7, YES is 1 and NO is 0. Supported cycle IDs are at most `2^252 - 1`. Position amounts use the same 18-decimal units as CST. `totalSupply(id)` counts issued user positions, excluding virtual pool reserves. Transfers change the holder, never total liabilities or the odds. The current holder receives sale, merge, or settlement proceeds.

`mergePosition` redeems one question's pairs. `mergePositions` takes a fixed array of eight amounts and redeems pairs from several questions atomically. The browser shows each question's mergeable amount and offers a single merge-all transaction. If the game/result source cannot be read, the recovery view can load a specified cycle directly from the market and allow merges and transfers from freshly read holdings.

## Shared liquidity and numerical safety

The contract represents up to 256 joint endings internally. It stores collateral and eight pairs of aggregate liabilities rather than writing 256 outcome-token balances for every trade. A feasible ending's virtual reserve is:

```text
reserve = accounted collateral − total claims that win in that ending
```

All feasible reserves must remain strictly positive during trading. The fixed product of those reserves may not decrease. Since that product cannot fit in a Solidity integer, `Log2Bounds` computes rigorous lower and upper bounds on binary logarithms. The contract accepts a proposed trade only when the sum of lower bounds for the new reserves is at least the sum of upper bounds for the old reserves. Equal factors are canceled exactly. See [the proof and accounting notes](src/libraries/LOG_BOUNDS.md).

The browser solves for an exact proposed trade using BigInt arithmetic. The contract independently verifies it. There is no trusted quote server, floating-point on-chain arithmetic, or user-supplied outcome. A price change can cause an exact quote to revert; refreshing the quote preserves the user's stated terms. Trades also carry an expiry. Very small trades can be unavailable because of conservative numerical bounds.

Every winning unit pays one CST. Partial claims clear only known questions. Other positions remain backed and tradeable. A known-answer cache rejects sources that reverse answers or reopen a previously closed cycle. Collateral is bounded by `2^120` wei, and supported tokens must transfer exact amounts: fee-on-transfer and rebasing behavior is unsupported.

The dashboard distinguishes **total CST held**, **maximum payout obligation**, and **minimum remaining reserve**. Buying adds CST to custody and issues a payout obligation; it does not make the entire deposit free sponsor capital. Selling, merging, and retrieving winners remove CST. A 100 CST YES purchase followed by a 100 CST NO purchase therefore adds 200 CST to custody, but the shares received need not be equal, since the first trade changes the second price.

Cold-state gas tests enforce the execution budget. With transferable positions, the implementation measures approximately 9.94 million gas for a diverse, full-256-state trade; this is a local EVM measurement, not a live fee quote.

## Local simulator versus the real game

The local game follows the V2 champion-record algorithm, strict tie behavior, ETH/CST calibration feedback, CST burns, and square-root gesture rewards. Its timers are shorter: a 24-minute opening countdown, one-minute extensions and a two-minute open-claim timeout. Cycle zero is a deterministic replayed fixture, making all comparisons usable immediately.

The simulator simplifies ETH opening prices and rollover settings, and omits NFTs, selection, and ETH allocation tracks. It is an integration test environment, not an economic forecast model. It uses chain time; local time controls call Anvil explicitly. It has no method for supplying arbitrary market answers.

## Checks

```sh
pnpm check:contracts  # compiler, sizes, all Solidity suites, both vector generators
pnpm check:frontend   # formatting, lint, types, coverage, build, dependency audit
pnpm test:tooling     # Git gate and fixture-consistency regression tests
pnpm check:vectors   # reproduce checked-in Solidity/TypeScript differential fixtures
pnpm test:e2e:install # install the isolated Chromium test browser once
pnpm test:e2e         # disposable Anvil + deployed contracts + real browser flows
pnpm check           # complete pre-push gate
pnpm test:heavy      # 50,000 fuzz cases; 512 campaigns × 256 invariant actions
```

The normal profile runs 1,000 cases per fuzz property and 64 × 64 actions per invariant campaign. New coverage includes every one of the 256 terminal answers, multi-cycle liabilities and rollover, partial claims, directed-rounding boundaries, source contradictions, exact token accounting, reentrancy on every transfer path, direct transfers, and frontend/contract differential execution. The local champion calculator is compared with an independent record-episode model.

Nightly CI runs the heavy profile and records a reproducible seed. Failures must be fixed or investigated; passing tests are not a substitute for an independent security audit before real-value deployment.

Git hooks are installed by `pnpm setup:dev`. Pre-commit verifies the staged sources, formatting, relevant whole suites, and generated vectors. Pre-push adds production build, coverage, browser tests, and dependency audits. CI independently enforces the gates. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Before a real-CST pilot

The live V2 game does not retain all eight historical statistics. The local source must never be substituted for a production resolver. A future integration must either verify historical game receipts against authenticated Arbitrum block hashes, or use game-provided immutable per-cycle statistics after an upgrade. Neither plain indexer responses nor creator-signed results meet the intended trustless design.

An immutable production adapter, its liveness/recovery plan, gas measurements on Arbitrum, and independent financial review are required before a real-CST launch. This branch does not broadcast a public deployment or change the existing production address.

A future game upgrade can issue a fixed funding budget to the same market interface. That is separate from this version's creator-contributed funding and must not grant the market unlimited minting authority.
