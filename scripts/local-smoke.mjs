import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { localRpc } from "./local-runtime.mjs";
import { assertAbiSubset, readBrowserAbi } from "./browser-abi.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "frontend/package.json"));
const { createPublicClient, createWalletClient, createTestClient, http } = require("viem");
const { anvil } = require("viem/chains");
const ts = require("typescript");
const ONE = 10n ** 18n;
const deployment = JSON.parse(
  await readFile(path.join(root, ".local/shared-deployment.json"), "utf8"),
);
localRpc(deployment);
assert.equal(
  deployment.marketKind,
  "independent",
  "Restart dev:local for the independent deployment",
);
const transport = http(deployment.rpcUrl);
const client = createPublicClient({ chain: anvil, transport, pollingInterval: 100 });
assert.equal(await client.getChainId(), 31337, "Never send smoke transactions to a public chain");
const tester = createTestClient({ chain: anvil, mode: "anvil", transport });
const accounts = await client.request({ method: "eth_accounts" });
assert.ok(accounts.length >= 3);
const wallets = [1, 2].map((index) =>
  createWalletClient({ chain: anvil, account: accounts[index], transport }),
);
const abi = async (name, source = name) =>
  JSON.parse(await readFile(path.join(root, "out", `${source}.sol`, `${name}.json`), "utf8")).abi;
const marketAbi = await abi("IndependentOutcomeMarket");
const gameAbi = await abi("LocalCosmicGame");
const tokenAbi = await abi("LocalCst");
const sourceAbi = await abi("LocalOutcomeSource");
const vaultAbi = await abi("OutcomeSettlementVault");
const verifierAbi = await abi("IndependentMarketViews", "IndependentOutcomeMarket");
for (const [file, name, compiled] of [
  ["frontend/src/independent/abi.ts", "independentMarketAbi", marketAbi],
  ["frontend/src/independent/abi.ts", "independentSourceAbi", sourceAbi],
  ["frontend/src/independent/abi.ts", "settlementVaultAbi", vaultAbi],
  ["frontend/src/shared/abi.ts", "localGameAbi", gameAbi],
  ["frontend/src/shared/abi.ts", "localTokenAbi", tokenAbi],
]) {
  assertAbiSubset(name, await readBrowserAbi(root, file, name), compiled, [
    tokenAbi,
    sourceAbi,
    vaultAbi,
    verifierAbi,
  ]);
}
const market = deployment.marketAddress;
const game = deployment.gameAddress;
const source = deployment.sourceAddress;
const read = (address, abi_, functionName, args = []) =>
  client.readContract({ address, abi: abi_, functionName, args });
const token = await read(market, marketAbi, "cst");
const vault = await read(market, marketAbi, "settlementVault");
assert.equal(vault.toLowerCase(), deployment.vaultAddress.toLowerCase());
assert.equal(await read(token, tokenAbi, "name"), "Local Cosmic Signature Token");
assert.equal(await read(game, gameAbi, "TIME_INCREMENT"), 60n);
const sendAs = async (wallet, address, abi_, functionName, args = [], value = 0n) => {
  const hash = await wallet.writeContract({
    address,
    abi: abi_,
    functionName,
    args,
    value,
    gas: 30_000_000n,
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success", functionName);
  assert.ok(receipt.gasUsed < 32_000_000n);
  return receipt;
};
const send = (...args) => sendAs(wallets[0], ...args);
const receive = (...args) => sendAs(wallets[1], ...args);
const states = (round) => read(market, marketAbi, "questionStates", [round]);
const cash = (qs) => qs.reduce((sum, q) => sum + q.activeCollateral, 0n);
const pool = (q) => ({
  collateral: q.activeCollateral,
  yes: q.yesSupply,
  no: q.noSupply,
  initialYesBps: Number(q.initialYesBps),
});
const allocation = (amount, q) => amount / 8n + (BigInt(q) < amount % 8n ? 1n : 0n);

// Compile the actual browser solver; do not keep a second smoke-test implementation.
const runtime = path.join(root, ".local/smoke-runtime");
await mkdir(runtime, { recursive: true });
for (const module of ["questions", "math", "independent-math"]) {
  const sourceText = await readFile(path.join(root, "frontend/src/shared", `${module}.ts`), "utf8");
  const compiled = ts
    .transpileModule(sourceText, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    })
    .outputText.replaceAll('"./questions"', '"./questions.mjs"')
    .replaceAll('"./math"', '"./math.mjs"');
  await writeFile(path.join(runtime, `${module}.mjs`), compiled);
}
const { quoteIndependentTrade, questionReserves } = await import(
  pathToFileURL(path.join(runtime, "independent-math.mjs"))
);
const trade = async (round, question, yes, buy, input) => {
  const before = await states(round);
  const output = quoteIndependentTrade(pool(before[question]), yes, buy, input);
  assert.ok(output > 0n, "Browser must find an executable quote");
  await send(market, marketAbi, buy ? "buy" : "sell", [
    round,
    question,
    yes,
    input,
    output,
    (await client.getBlock()).timestamp + 900n,
  ]);
  const after = await states(round);
  for (let q = 0; q < 8; q++)
    if (q !== question)
      assert.deepEqual(
        after[q],
        before[q],
        "A trade changed another question's price or accounting",
      );
  return output;
};
const snapshot = await tester.snapshot();
try {
  const round = await read(game, gameAbi, "roundNum");
  assert.equal(
    (await read(game, gameAbi, "roundStats", [round])).gestureCount,
    0n,
    "Start a fresh local stack before smoke testing",
  );
  const initial = await states(round);
  for (const q of initial) {
    assert.equal(q.activeCollateral, 1250n * ONE);
    assert.equal(Number(q.initialYesBps), 5000);
  }
  await send(token, tokenAbi, "faucet", [10_000n * ONE]);
  await send(token, tokenAbi, "approve", [market, 10_000n * ONE]);
  const balanceBeforeSets = await read(token, tokenAbi, "balanceOf", [accounts[1]]);
  await send(market, marketAbi, "splitPosition", [round, 2, 25n * ONE]);
  assert.deepEqual(
    questionReserves(pool((await states(round))[2])),
    questionReserves(pool(initial[2])),
  );
  await send(market, marketAbi, "mergePosition", [round, 2, 10n * ONE]);
  await send(market, marketAbi, "splitPosition", [round, 1, 7n * ONE]);
  const matched = Array(8).fill(0n);
  matched[1] = 7n * ONE;
  matched[2] = 15n * ONE;
  await send(market, marketAbi, "mergePositions", [round, matched]);
  assert.deepEqual(await states(round), initial);
  assert.equal(await read(token, tokenAbi, "balanceOf", [accounts[1]]), balanceBeforeSets);

  const receiverStart = await read(token, tokenAbi, "balanceOf", [accounts[2]]);
  for (const [q, amount, operator] of [
    [3, 5n * ONE, false],
    [4, 3n * ONE, true],
  ]) {
    await send(market, marketAbi, "splitPosition", [round, q, amount]);
    const ids = await Promise.all(
      [false, true].map((yes) => read(market, marketAbi, "positionId", [round, q, yes])),
    );
    if (operator) {
      await send(market, marketAbi, "setApprovalForAll", [accounts[2], true]);
      await receive(market, marketAbi, "safeBatchTransferFrom", [
        accounts[1],
        accounts[2],
        ids,
        [amount, amount],
        "0x",
      ]);
      await send(market, marketAbi, "setApprovalForAll", [accounts[2], false]);
      assert.equal(
        await read(market, marketAbi, "isApprovedForAll", [accounts[1], accounts[2]]),
        false,
      );
    } else {
      for (const id of ids)
        await send(market, marketAbi, "safeTransferFrom", [
          accounts[1],
          accounts[2],
          id,
          amount,
          "0x",
        ]);
    }
    await receive(market, marketAbi, "mergePosition", [round, q, amount]);
  }
  assert.equal(await read(token, tokenAbi, "balanceOf", [accounts[2]]), receiverStart + 8n * ONE);
  assert.deepEqual(await states(round), initial);
  await trade(round, 0, true, true, 100n * ONE);
  const q5Units = await trade(round, 5, false, true, 100n * ONE);
  await trade(round, 5, false, false, q5Units / 4n);
  await trade(round, 6, true, true, 25n * ONE);
  await trade(round, 7, true, true, 50n * ONE);
  const beforeGift = await states(round);
  await send(market, marketAbi, "fundRound", [round, 8n * ONE + 3n]);
  const afterGift = await states(round);
  for (let q = 0; q < 8; q++)
    assert.equal(
      afterGift[q].activeCollateral - beforeGift[q].activeCollateral,
      allocation(8n * ONE + 3n, q),
    );

  for (let i = 0; i < 7; i++)
    await send(game, gameAbi, "bidEth", [], await read(game, gameAbi, "getNextEthPrice"));
  const [startedAt] = await read(source, sourceAbi, "cycleTimes", [round]);
  const closeAt = (await read(game, gameAbi, "mainPrizeTime")) + 1n;
  const [, finalized, known] = await read(source, sourceAbi, "outcomeState", [round]);
  assert.equal(finalized, false);
  assert.ok((known & 1) !== 0, "The gesture-count answer is mathematically known");
  await trade(round, 0, true, true, 20n * ONE);
  await assert.rejects(
    client.simulateContract({
      address: market,
      abi: marketAbi,
      functionName: "claimKnown",
      args: [round],
      account: accounts[1],
    }),
    /NotFinalized|not finalized|revert/i,
  );

  await tester.setNextBlockTimestamp({ timestamp: startedAt + 700n });
  await trade(round, 0, true, true, 80n * ONE);
  const priceBeforeMiddle = Number((await states(round))[0].currentYesBps);
  await tester.setNextBlockTimestamp({ timestamp: startedAt + 900n });
  await trade(round, 0, false, true, 40n * ONE);
  const priceAfterMiddle = Number((await states(round))[0].currentYesBps);
  await tester.setNextBlockTimestamp({ timestamp: startedAt + 1100n });
  await trade(round, 0, true, true, 10n * ONE);
  const t40 = startedAt + ((closeAt - startedAt) * 2n) / 5n;
  const t60 = startedAt + ((closeAt - startedAt) * 3n) / 5n;
  const expectedMiddle = Number(
    (BigInt(priceBeforeMiddle) * (startedAt + 900n - t40) +
      BigInt(priceAfterMiddle) * (t60 - startedAt - 900n)) /
      (t60 - t40),
  );
  await tester.setNextBlockTimestamp({ timestamp: closeAt });
  await send(game, gameAbi, "closeCycle");
  const beforeSettlement = await states(round);
  const [, final, , answers] = await read(source, sourceAbi, "outcomeState", [round]);
  assert.equal(final, true);
  const owed = beforeSettlement.map((q, i) =>
    (answers & (1 << i)) !== 0 ? q.yesSupply : q.noSupply,
  );
  const owedTotal = owed.reduce((sum, amount) => sum + amount, 0n);
  const carry = cash(beforeSettlement) - owedTotal;
  assert.ok(carry > 0n);
  const nextRound = await read(game, gameAbi, "roundNum");
  await send(market, marketAbi, "fundRound", [nextRound, 8n * ONE]);
  const next = await states(nextRound);
  assert.equal(
    cash(await states(round)),
    0n,
    "Old active liquidity must be zero immediately after settlement",
  );
  assert.equal(await read(token, tokenAbi, "balanceOf", [vault]), owedTotal);
  for (let q = 0; q < 8; q++) {
    assert.equal(await read(vault, vaultAbi, "remaining", [round, q]), owed[q]);
    assert.equal(next[q].activeCollateral, allocation(carry + 8n * ONE, q));
  }
  assert.equal(
    Number(next[0].initialYesBps),
    expectedMiddle,
    "Next cycle inherits the actual 40–60% time-weighted price",
  );
  assert.equal(await read(market, marketAbi, "pendingCarry"), 0n);
  await send(market, marketAbi, "settleRound", [round]);
  assert.deepEqual(await states(nextRound), next, "Duplicate settlement must not allocate again");

  // Only this disposable Anvil source is made unavailable. Cached old payouts
  // must still succeed without touching the newly funded cycle's liquidity.
  const sourceCode = await client.getCode({ address: source });
  await tester.setCode({ address: source, bytecode: "0x60006000fd" });
  const beforeClaim = await read(token, tokenAbi, "balanceOf", [accounts[1]]);
  await send(market, marketAbi, "claimKnown", [round]);
  assert.equal(await read(token, tokenAbi, "balanceOf", [accounts[1]]), beforeClaim + owedTotal);
  assert.equal(await read(token, tokenAbi, "balanceOf", [vault]), 0n);
  assert.deepEqual(await states(nextRound), next);
  await tester.setCode({ address: source, bytecode: sourceCode });

  // A cycle with no trades rolls all its sponsor capital forward. No new CST
  // payment or token approval is needed to activate the following cycle.
  await send(game, gameAbi, "bidEth", [], await read(game, gameAbi, "getNextEthPrice"));
  await tester.setNextBlockTimestamp({
    timestamp: (await read(game, gameAbi, "mainPrizeTime")) + 1n,
  });
  await send(game, gameAbi, "closeCycle");
  const thirdRound = await read(game, gameAbi, "roundNum");
  const walletBeforeCarry = await read(token, tokenAbi, "balanceOf", [accounts[1]]);
  await send(market, marketAbi, "fundRound", [thirdRound, 0n]);
  assert.equal(await read(token, tokenAbi, "balanceOf", [accounts[1]]), walletBeforeCarry);
  assert.equal(cash(await states(nextRound)), 0n);
  assert.equal(cash(await states(thirdRound)), cash(next));
  assert.equal(await read(token, tokenAbi, "balanceOf", [market]), cash(next));
  assert.equal(await read(token, tokenAbi, "balanceOf", [vault]), 0n);
  console.log(
    "Independent smoke passed: exact quotes, isolation, split/merge, transfers/operators, remainder funding, end-only payouts, midpoint inheritance, automatic carry, source-outage late claims, and empty-cycle rollover.",
  );
} finally {
  await tester.revert({ id: snapshot });
}
