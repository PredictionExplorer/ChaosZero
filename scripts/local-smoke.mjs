import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { localRpc } from "./local-runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "frontend/package.json"));
const {
  createPublicClient,
  createWalletClient,
  createTestClient,
  http,
  parseAbi,
} = require("viem");
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
assert.ok(accounts.length >= 3, "Expected unlocked Anvil accounts");
const wallets = [1, 2].map((index) =>
  createWalletClient({ chain: anvil, account: accounts[index], transport }),
);
const abi = async (name) =>
  JSON.parse(await readFile(path.join(root, "out", `${name}.sol`, `${name}.json`), "utf8")).abi;
const marketAbi = await abi("SharedOutcomeMarket");
const gameAbi = await abi("LocalCosmicGame");
const tokenAbi = await abi("LocalCst");
const sourceAbi = await abi("LocalOutcomeSource");

// Check the interface the browser actually uses against the Solidity compiler.
// Parameter names/internalType are not wire types; tuple members and return
// values are. Token errors may bubble through the market or local game.
const browserAbiSource = ts.createSourceFile(
  "abi.ts",
  await readFile(path.join(root, "frontend/src/shared/abi.ts"), "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
const paramShape = (parameter) => ({
  type: parameter.type,
  ...(parameter.components ? { components: parameter.components.map(paramShape) } : {}),
});
const signatureShape = (item) => ({
  type: item.type,
  name: item.name,
  inputs: item.inputs?.map(paramShape),
  ...(item.type === "function"
    ? { outputs: item.outputs.map(paramShape), stateMutability: item.stateMutability }
    : {}),
});
for (const [exportName, compiledAbi] of [
  ["sharedMarketAbi", marketAbi],
  ["outcomeSourceAbi", sourceAbi],
  ["localGameAbi", gameAbi],
  ["localTokenAbi", tokenAbi],
]) {
  const declaration = browserAbiSource.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((entry) => ts.isIdentifier(entry.name) && entry.name.text === exportName);
  const call = declaration?.initializer;
  assert.ok(call && ts.isCallExpression(call), `Missing browser ABI: ${exportName}`);
  assert.equal(call.expression.getText(browserAbiSource), "parseAbi");
  const definitions = call.arguments[0];
  assert.ok(ts.isArrayLiteralExpression(definitions));
  const declarations = definitions.elements.map((element) => {
    assert.ok(ts.isStringLiteral(element), "Browser ABI must use reviewable literal signatures");
    return element.text;
  });
  for (const item of parseAbi(declarations)) {
    const candidates = item.type === "error" ? [...compiledAbi, ...tokenAbi] : compiledAbi;
    assert.ok(
      candidates.some(
        (candidate) =>
          JSON.stringify(signatureShape(candidate)) === JSON.stringify(signatureShape(item)),
      ),
      `Browser/Solidity ABI drift: ${exportName}.${item.name}`,
    );
  }
}
const market = deployment.marketAddress;
const game = deployment.gameAddress;
const source = deployment.sourceAddress;
const read = (address, abi_, functionName, args = []) =>
  client.readContract({ address, abi: abi_, functionName, args });
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
  assert.ok(receipt.gasUsed < 32_000_000n, "Every operation must fit the chain execution cap");
  return receipt;
};
const send = (...args) => sendAs(wallets[0], ...args);
const receive = (...args) => sendAs(wallets[1], ...args);
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
const { quoteTrade, claimable, feasibleReserves } = await import(
  pathToFileURL(path.join(runtime, "math.mjs"))
);
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
  assert.equal(await read(market, marketAbi, "supportsInterface", ["0xd9b67a26"]), true);
  const initialPool = await pool();
  const initialReserves = feasibleReserves(initialPool);
  const initialBalance = await read(token, tokenAbi, "balanceOf", [accounts[1]]);
  await send(market, marketAbi, "splitPosition", [round, 2, 25n * ONE]);
  assert.equal((await pool()).collateral, initialPool.collateral + 25n * ONE);
  assert.equal(await read(token, tokenAbi, "balanceOf", [accounts[1]]), initialBalance - 25n * ONE);
  assert.deepEqual(
    feasibleReserves(await pool()),
    initialReserves,
    "Splitting preserves all 256 reserves",
  );
  const [splitYes, splitNo] = await read(market, marketAbi, "balancesOf", [round, accounts[1]]);
  assert.equal(splitYes[2], 25n * ONE);
  assert.equal(splitNo[2], 25n * ONE);
  await send(market, marketAbi, "mergePosition", [round, 2, 10n * ONE]);
  assert.equal(await read(token, tokenAbi, "balanceOf", [accounts[1]]), initialBalance - 15n * ONE);
  assert.deepEqual(feasibleReserves(await pool()), initialReserves);
  await send(market, marketAbi, "splitPosition", [round, 1, 7n * ONE]);
  const batch = Array(8).fill(0n);
  batch[1] = 7n * ONE;
  batch[2] = 15n * ONE;
  await send(market, marketAbi, "mergePositions", [round, batch]);
  assert.deepEqual(await pool(), initialPool, "Split/merge restores the exact pool accounting");
  assert.equal(await read(token, tokenAbi, "balanceOf", [accounts[1]]), initialBalance);

  const receiverBalance = await read(token, tokenAbi, "balanceOf", [accounts[2]]);
  await send(market, marketAbi, "splitPosition", [round, 3, 5n * ONE]);
  for (const side of [false, true]) {
    const id = await read(market, marketAbi, "positionId", [round, 3, side]);
    assert.equal(id, (round << 4n) | 6n | (side ? 1n : 0n));
    await send(market, marketAbi, "safeTransferFrom", [
      accounts[1],
      accounts[2],
      id,
      5n * ONE,
      "0x",
    ]);
    assert.equal(await read(market, marketAbi, "balanceOf", [accounts[2], id]), 5n * ONE);
    assert.equal(await read(market, marketAbi, "totalSupply", [id]), 5n * ONE);
  }
  await receive(market, marketAbi, "mergePosition", [round, 3, 5n * ONE]);
  assert.equal(await read(token, tokenAbi, "balanceOf", [accounts[2]]), receiverBalance + 5n * ONE);
  assert.deepEqual(await pool(), initialPool);

  await send(market, marketAbi, "splitPosition", [round, 4, 3n * ONE]);
  const ids = await Promise.all(
    [false, true].map((side) => read(market, marketAbi, "positionId", [round, 4, side])),
  );
  await send(market, marketAbi, "setApprovalForAll", [accounts[2], true]);
  assert.equal(await read(market, marketAbi, "isApprovedForAll", [accounts[1], accounts[2]]), true);
  await receive(market, marketAbi, "safeBatchTransferFrom", [
    accounts[1],
    accounts[2],
    ids,
    [3n * ONE, 3n * ONE],
    "0x",
  ]);
  await receive(market, marketAbi, "mergePosition", [round, 4, 3n * ONE]);
  await send(market, marketAbi, "setApprovalForAll", [accounts[2], false]);
  assert.equal(
    await read(market, marketAbi, "isApprovedForAll", [accounts[1], accounts[2]]),
    false,
  );
  assert.equal(await read(token, tokenAbi, "balanceOf", [accounts[2]]), receiverBalance + 8n * ONE);
  assert.deepEqual(await pool(), initialPool, "Transfers and merges preserve sponsor capital");

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
  const splitOnlyRound = await read(game, gameAbi, "roundNum");
  await send(market, marketAbi, "splitPosition", [splitOnlyRound, 0, 4n * ONE]);
  const [splitOnlyCash, splitOnlyFunded] = await read(market, marketAbi, "roundAccounting", [
    splitOnlyRound,
  ]);
  assert.equal(splitOnlyCash, 4n * ONE);
  assert.equal(splitOnlyFunded, false, "Complete sets do not sponsor a pool");
  await send(market, marketAbi, "mergePosition", [splitOnlyRound, 0, 2n * ONE]);
  await send(game, gameAbi, "bidEth", [], await read(game, gameAbi, "getNextEthPrice"));
  await tester.setNextBlockTimestamp({
    timestamp: (await read(game, gameAbi, "mainPrizeTime")) + 1n,
  });
  await tester.mine({ blocks: 1 });
  await send(game, gameAbi, "closeCycle");
  const beforeUnfundedClaim = await read(token, tokenAbi, "balanceOf", [accounts[1]]);
  await send(market, marketAbi, "claimKnown", [splitOnlyRound]);
  assert.equal(
    await read(token, tokenAbi, "balanceOf", [accounts[1]]),
    beforeUnfundedClaim + 2n * ONE,
  );
  const [splitOnlyRemainder] = await read(market, marketAbi, "roundAccounting", [splitOnlyRound]);
  assert.equal(splitOnlyRemainder, 0n, "Unsponsored complete sets settle without trapped CST");
  const next = await read(game, gameAbi, "roundNum");
  await send(market, marketAbi, "rollover", [round, next]);
  const [nextCash, funded] = await read(market, marketAbi, "roundAccounting", [next]);
  assert.ok(funded && nextCash > 0n);
  console.log(
    "Local smoke passed: exact splits, individual/batch merges, ERC-1155 transfers and operators, reserve preservation, quotes, buys, sell, sponsorship, partial/final claims, split-only settlement, and rollover.",
  );
} finally {
  await tester.revert({ id: snapshot });
}
