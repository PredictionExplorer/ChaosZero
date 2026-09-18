import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { localRpc } from "./local-runtime.mjs";

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
const transport = http(deployment.rpcUrl);
const client = createPublicClient({ chain: anvil, transport });
assert.equal(await client.getChainId(), 31337, "Never send test transactions to a public chain");
const tester = createTestClient({ chain: anvil, mode: "anvil", transport });
const accounts = await client.request({ method: "eth_accounts" });
assert.ok(accounts.length >= 2, "Expected unlocked Anvil accounts");
const wallet = createWalletClient({ chain: anvil, account: accounts[1], transport });
const abi = async (name) =>
  JSON.parse(await readFile(path.join(root, "out", `${name}.sol`, `${name}.json`), "utf8")).abi;
const marketAbi = await abi("SharedOutcomeMarket");
const gameAbi = await abi("LocalCosmicGame");
const tokenAbi = await abi("LocalCst");
const sourceAbi = await abi("LocalOutcomeSource");
const market = deployment.marketAddress;
const game = deployment.gameAddress;
const source = deployment.sourceAddress;
const read = (address, abi_, functionName, args = []) =>
  client.readContract({ address, abi: abi_, functionName, args });
const send = async (address, abi_, functionName, args = [], value = 0n) => {
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
  assert.ok(receipt.gasUsed < 32_000_000n, "Every operation must fit the chain execution cap");
  return receipt;
};
const token = await read(market, marketAbi, "cst");
assert.equal(await read(token, tokenAbi, "name"), "Local Cosmic Signature Token");
assert.equal(await read(game, gameAbi, "TIME_INCREMENT"), 60n);

// Exercise the real frontend quote implementation, compiled locally without adding a second math copy.
const runtime = path.join(root, ".local/smoke-runtime");
await mkdir(runtime, { recursive: true });
for (const module of ["questions", "math"]) {
  const sourceText = await readFile(path.join(root, "frontend/src/shared", `${module}.ts`), "utf8");
  const compiled = ts
    .transpileModule(sourceText, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    })
    .outputText.replaceAll('"./questions"', '"./questions.mjs"');
  await writeFile(path.join(runtime, `${module}.mjs`), compiled);
}
const { quoteTrade, claimable } = await import(pathToFileURL(path.join(runtime, "math.mjs")));
const snapshot = await tester.snapshot();
try {
  const round = await read(game, gameAbi, "roundNum");
  const stats = await read(game, gameAbi, "roundStats", [round]);
  assert.equal(stats.gestureCount, 0n, "Restart dev:local for a fresh smoke-test cycle");
  await send(token, tokenAbi, "faucet", [10_000n * ONE]);
  await send(token, tokenAbi, "approve", [market, 1_000n * ONE]);
  const pool = async () => {
    const [[collateral], [yes, no], [, , knownMask, values]] = await Promise.all([
      read(market, marketAbi, "roundAccounting", [round]),
      read(market, marketAbi, "liabilities", [round]),
      read(source, sourceAbi, "outcomeState", [round]),
    ]);
    return { collateral, yes, no, knownMask, values };
  };
  for (const question of [0, 5, 6, 7]) {
    const input = 10n * ONE;
    const units = quoteTrade(await pool(), question, true, true, input);
    assert.ok(units > input);
    const deadline = (await client.getBlock()).timestamp + 900n;
    await send(market, marketAbi, "buy", [round, question, true, input, units, deadline]);
    const [yes] = await read(market, marketAbi, "balancesOf", [round, accounts[1]]);
    assert.equal(yes[question], units, "Frontend quote exactly equals executed position");
  }
  const [owned] = await read(market, marketAbi, "balancesOf", [round, accounts[1]]);
  const sold = owned[5] / 2n;
  const proceeds = quoteTrade(await pool(), 5, true, false, sold);
  assert.ok(proceeds > 0n);
  await send(market, marketAbi, "sell", [
    round,
    5,
    true,
    sold,
    proceeds,
    (await client.getBlock()).timestamp + 900n,
  ]);
  const collateralBeforeGift = (await pool()).collateral;
  await send(market, marketAbi, "fundRound", [round, 25n * ONE]);
  assert.equal((await pool()).collateral, collateralBeforeGift + 25n * ONE);

  await send(game, gameAbi, "bidEth", [], await read(game, gameAbi, "getNextEthPrice"));
  await send(game, gameAbi, "bidCst", [await read(game, gameAbi, "getNextCstPrice")]);
  const partial = await pool();
  assert.equal(
    partial.knownMask & 128,
    128,
    "Highest CST question resolves directly from game action",
  );
  const beforePartial = await read(token, tokenAbi, "balanceOf", [accounts[1]]);
  const [yes, no] = await read(market, marketAbi, "balancesOf", [round, accounts[1]]);
  const partialPayout = claimable(yes, no, partial.knownMask, partial.values);
  await send(market, marketAbi, "claimKnown", [round]);
  assert.equal(
    await read(token, tokenAbi, "balanceOf", [accounts[1]]),
    beforePartial + partialPayout,
  );

  const deadline = await read(game, gameAbi, "mainPrizeTime");
  await tester.setNextBlockTimestamp({ timestamp: deadline + 1n });
  await tester.mine({ blocks: 1 });
  await send(game, gameAbi, "closeCycle");
  const [, finalized, knownMask, values] = await read(source, sourceAbi, "outcomeState", [round]);
  assert.equal(finalized, true);
  assert.equal(knownMask, 255);
  assert.equal(values & 32, 0, "Equal ETH/CST gesture counts resolve NO");
  assert.equal(values & 64, 64, "One local performance earns both titles in this trajectory");
  const beforeFinal = await read(token, tokenAbi, "balanceOf", [accounts[1]]);
  const [remainingYes, remainingNo] = await read(market, marketAbi, "balancesOf", [
    round,
    accounts[1],
  ]);
  const payout = claimable(remainingYes, remainingNo, knownMask, values);
  await send(market, marketAbi, "claimKnown", [round]);
  assert.equal(await read(token, tokenAbi, "balanceOf", [accounts[1]]), beforeFinal + payout);
  const cleared = await read(market, marketAbi, "balancesOf", [round, accounts[1]]);
  assert.ok([...cleared[0], ...cleared[1]].every((n) => n === 0n));
  const next = await read(game, gameAbi, "roundNum");
  await send(market, marketAbi, "rollover", [round, next]);
  const [nextCash, funded] = await read(market, marketAbi, "roundAccounting", [next]);
  assert.ok(funded && nextCash > 0n);
  console.log(
    "Local smoke passed: exact quotes, buys, sell, sponsorship, partial claims, game settlement, final claims, and rollover.",
  );
} finally {
  await tester.revert({ id: snapshot });
}
