# Chaos Zero

Eight recurring questions about Cosmic Signature, each with independent CST liquidity, funded together through one market contract.

**This branch is a local prototype.** It includes independent question-pool accounting, fake CST, an on-chain game simulator, and a browser interface with extensive financial/property tests. No live eight-question result adapter is shipped. The simulator and its outcome adapter reject deployment on chains other than `31337`; the prototype frontend rejects public-chain use. The existing production binary market and its configuration remain available, with their documentation in [LEGACY_MARKET.md](LEGACY_MARKET.md).

## Run the complete local system

Requirements: Foundry `v1.7.1` (`forge` and `anvil`), pnpm `10.32.0`, and Node 22.23.2 or a supported Node 24 release. CI pins Node 22.23.2.

```sh
pnpm setup:dev
pnpm dev:local
```

Open <http://127.0.0.1:3000/shared>. Connect a local test wallet and use **Get 1,000 test CST**. Buy or sell positions, split CST into complete YES/NO pairs, merge matching pairs back into CST, or transfer positions to another wallet. You can also make an irreversible gift to the pool, place simulated game gestures, advance local time, close a cycle, retrieve winning positions, and carry unused funding into the next funded cycle. Three disposable test wallets let you exercise transfers and redemption by the recipient.

The launcher starts a fresh Anvil chain, deploys fake CST and the local game, deploys the independent market and its payout vault, contributes 10,000 fake CST divided equally across eight pools, and starts Next.js with the matching addresses. It uses only Anvil's public unlocked accounts; it never needs a private key. Stop it with Ctrl+C. All development funds are disposable.

The default ports are 3000 for the website and 8545 for Anvil. Override them without editing files:

```sh
PORT=3100 ANVIL_PORT=8555 pnpm dev:local
```

The launcher refuses occupied ports instead of attaching to an unrelated process. Deployment details are written to the ignored `.local/shared-deployment.json`. With the local system running, `pnpm local:smoke` executes the real frontend quote code against the deployed contracts, then restores an Anvil snapshot.

## The eight fixed questions

Questions 0–4 and 7 compare against the preceding finalized cycle. Questions 5
and 6 use only the current cycle: 5 is the parity of its total gesture count, 6
a same-gesture fact. Both are decided only at closure. Strict-comparison ties
resolve NO.

| ID  | Question                                         | Result                                                                                                   |
| --- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| 0   | More gestures than the previous cycle?           | Total ETH and CST gesture count is greater.                                                              |
| 1   | Longer Endurance Champion time?                  | Maximum uninterrupted duration is greater.                                                               |
| 2   | Longer Chrono Warrior time?                      | Maximum tenure of an Endurance record is greater.                                                        |
| 3   | More ETH spent on gestures?                      | Actual ETH gesture payments are greater; separate contributions are excluded.                            |
| 4   | More CST burned through gestures?                | CST gesture payments are greater; unrelated token burns are excluded.                                    |
| 5   | Odd number of gestures?                          | The final total of ETH and CST gestures is odd; an even total resolves NO.                               |
| 6   | Does the same gesture earn Endurance and Chrono? | The two winning record episodes originate from the same gesture. Matching wallets alone is insufficient. |
| 7   | Higher maximum CST payment?                      | The largest CST amount actually paid for one gesture is greater.                                         |

Questions 0–4 and 7 can become permanently YES before closure. The independent market keeps trading open until the game actually closes the cycle; all eight payouts settle together. A known or highly predictable question can consume only its own funding. Anyone can flip question 5 with one more gesture, even a zero-price CST gesture, and every gesture extends the countdown, so its price reflects a contest over the final gesture rather than a forecast. The source still validates monotonic facts, and the UI distinguishes those facts from final settlement.

## Funding, settlement and rollover

`IndependentOutcomeMarket` does not mint CST. Anyone may call `fundRound(cycle, newAmount)` to contribute existing CST. Contributions are irreversible gifts: no LP shares, fees, refunds, or sponsor withdrawal authority. Each contribution is divided equally across eight questions; indivisible base-unit remainders go to the lowest question IDs, with at most one unit difference.

Each question keeps its own collateral and YES/NO liabilities. A trade in one question changes none of the other seven pools. All positions remain standard ERC-1155 tokens, and one winning unit pays exactly one CST.

After actual game closure, anyone can call `settleRound`. For each question, the contract reserves all outstanding winning shares in `OutcomeSettlementVault`, zeros its active collateral, and adds the remaining CST to `pendingCarry`. There is no winner bonus. Claimants never need to coordinate or claim first; old claims have no expiry and cannot become another cycle's funding.

The next first funding transaction automatically settles the latest previously funded cycle and combines its surplus with new CST before trading starts. Carry is divided equally across the new eight pools. `fundRound(cycle, 0)` can start a market using carry alone when sufficient funds exist. If game cycles pass without funded markets, the credit waits for the next funded cycle without an unbounded catch-up loop.

Automatic carry never arrives later as a price-changing top-up to an already-funded cycle. Voluntary additional gifts are separate: they can move prices toward the cycle's fixed initial odds. Initial funding has a numerical headroom cap; exceptional excess carry stays explicitly pending for later cycles instead of trapping the next pool at its collateral ceiling.

The token, source, payout vault and read-only helper contracts are fixed at deployment. The market has no administrator or upgrade mechanism. Direct CST transfers are excluded from accounting; use `fundRound`.

## Complete sets and transferable positions

One CST splits into one YES unit and one NO unit for **one question in one cycle**. A matching pair merges back into exactly one CST, without a fee or price change. Splitting and merging change collateral and the corresponding liabilities equally, leaving every virtual AMM reserve unchanged. YES from one question cannot be paired with NO from another question or cycle.

Splitting requires an open cycle, even if that question's answer is already known. It works before sponsorship, but does not fund the AMM: a pool containing only split collateral has no trading reserve. Complete sets can still be merged or settled if no sponsor ever funds that cycle. Merging is available after closure and after unused funding rolls forward; settled pairs are paid from their original question’s escrow. It deliberately makes no call to the result source, so matched pairs remain redeemable if that source becomes unavailable. Retrieval burns the caller’s positions after final settlement; those burned units cannot also be merged.

Once the market has settled the cycle, `claimKnown` pays according to the permanently cached answers without another source call. This also covers winning positions transferred after finalization. Before settlement is cached, retrieval requires a fresh, consistent source response and full cycle closure. Recovery operations must use fresh wallet balances and the same network/account guards as ordinary transactions.

Positions implement ERC-1155 using pinned OpenZeppelin Contracts. Standard `balanceOf`, `balanceOfBatch`, safe single/batch transfers, operator approvals, ERC-165 discovery, and on-chain metadata are available. An approved operator can transfer **all** of an owner's position types, including positions acquired later, until approval is revoked. The web interface sends owner-authorized transfers and requires no operator approval. Smart-contract recipients must implement ERC-1155 acceptance callbacks.

The position ID is `(cycle << 4) | (question << 1) | side`, where question IDs are 0–7, YES is 1 and NO is 0. Supported cycle IDs are at most `2^252 - 1`. Position amounts use the same 18-decimal units as CST. `totalSupply(id)` counts issued user positions, excluding virtual pool reserves. Transfers change the holder, never total liabilities or the odds. The current holder receives sale, merge, or settlement proceeds.

`mergePosition` redeems one question's pairs. `mergePositions` takes a fixed array of eight amounts and redeems pairs from several questions atomically. The browser shows each question's mergeable amount and offers a single merge-all transaction. If the game/result source cannot be read, the recovery view can load a specified cycle directly from the market and allow merges and transfers from freshly read holdings.

## Independent pricing and inherited initial odds

Every question uses its own weighted fixed-product curve. Its reserves are `C - YES supply` and `C - NO supply`, with fixed positive weights encoding its initial YES probability. The real liabilities contain only issued tokens. Exact trade amounts are verified by rigorously enclosing logarithm bounds; the browser independently solves quotes using BigInt. See [the numerical and accounting arguments](src/libraries/LOG_BOUNDS.md).

Starting probabilities come from the **time-weighted average of the previous cycle’s recorded quotes over 40–60% of its duration**. These percentages describe a time window, not a restriction on market odds. Canonical game start/closure timestamps define the window; a delayed market settlement cannot move it. Packed cumulative-price checkpoints make each lookup logarithmic in history length, and repeated observations at one timestamp gain no additional weight.

If the window is not covered or has zero duration, the previous initial seed is retained. If the immediately preceding game cycle has no initialized market, the fallback is 50%. Seeds are bounded to 1–9,999 basis points so both outcome weights remain positive. Historical middle prices are a starting heuristic: six questions have different thresholds in the next cycle, and thin-market prices can be influenced.

Each winning share pays one CST. Buying increases custody and issues claims; it does not turn the full deposit into free sponsor capital. The interface separates active collateral, payout escrow, carry, and each question’s remaining reserve. Splitting and merging preserve both reserves and prices.

There are no trading fees. Quotes specify exact amounts and an expiry; changing state can invalidate them, and very small trades can be unavailable because of integer bounds. Collateral is bounded by `2^120` base units per question. Tokens must transfer exact amounts; transfer taxes and rebasing are unsupported.

## Local simulator versus the real game

The local game follows the V2 champion-record algorithm, strict tie behavior, ETH/CST calibration feedback, CST burns, and square-root gesture rewards. Its timers are shorter: a 24-minute opening countdown, one-minute extensions and a two-minute open-claim timeout. Cycle zero is a deterministic replayed fixture, making all comparisons usable immediately.

The simulator simplifies ETH opening prices and rollover settings, and omits NFTs, selection, and ETH allocation tracks. It is an integration test environment, not an economic forecast model. It uses chain time; local time controls call Anvil explicitly. It has no method for supplying arbitrary market answers.

## Checks

```sh
pnpm check:contracts  # compiler, sizes, all Solidity suites, three vector generators
pnpm check:frontend   # formatting, lint, types, coverage, build, dependency audit
pnpm test:tooling     # Git gate and fixture-consistency regression tests
pnpm check:vectors   # reproduce checked-in Solidity/TypeScript differential fixtures
pnpm test:e2e:install # install the isolated Chromium test browser once
pnpm test:e2e         # disposable Anvil + deployed contracts + real browser flows
pnpm check           # complete pre-push gate
pnpm test:heavy      # 50,000 fuzz cases; 512 campaigns × 256 invariant actions
```

The normal profile runs 1,000 cases per fuzz property and 64 × 64 actions per invariant campaign. Coverage includes independent question/cycle accounting, late claims, rollover, weighted pricing boundaries, middle-window history, source contradictions, exact token transfers, receiver callbacks, and compiler/frontend differential execution. The prior shared engine’s 256 terminal and 6,561 partial-state tests remain as regression coverage. The local champion calculator is compared with an independent record-episode model.

Nightly CI runs the heavy profile and records a reproducible seed. Failures must be fixed or investigated; passing tests are not a substitute for an independent security audit before real-value deployment.

Git hooks are installed by `pnpm setup:dev`. Pre-commit verifies the staged sources, formatting, relevant whole suites, and generated vectors. Pre-push adds production build, coverage, browser tests, and dependency audits. CI independently enforces the gates. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Before a real-CST pilot

See [the concise game-storage requirements](GAME_STORAGE_REQUIREMENTS.md) for the upgrade path, including reuse of the champion-duration history already present in V3 source.

The live V2 game does not retain all eight historical statistics. The local source must never be substituted for a production resolver. A future integration must either verify historical game receipts against authenticated Arbitrum block hashes, or use game-provided immutable per-cycle statistics after an upgrade. Neither plain indexer responses nor creator-signed results meet the intended trustless design.

An immutable production adapter, its liveness/recovery plan, gas measurements on Arbitrum, and independent financial review are required before a real-CST launch. This branch does not broadcast a public deployment or change the existing production address.

A future game upgrade can issue a fixed funding budget to the same market interface. That is separate from this version's creator-contributed funding and must not grant the market unlimited minting authority.
