import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { pathToFileURL } from "node:url";
import { ContractFactory, JsonRpcProvider, getAddress, getCreateAddress, keccak256 } from "ethers";
import {
  buildSuccessor,
  childrenOf,
  creationReceipt,
  deployedRuntime,
  foundryArtifact,
  hardhatArtifact,
  readJson,
  reviewedSuccessorCreation,
  root,
} from "./bytecode-identity.mjs";
import { ARBITRUM, assertChain, constructorArgs } from "./deploy-runtime.mjs";
import { SOURCE } from "./prepare-game-funded-market.mjs";

async function archivedSingleQuestion() {
  // V1 used only the forge-std remapping. Source-unit names and even unused remappings
  // contribute to the Solidity metadata hash. Keep this build out of V4's caches.
  const dir = await mkdtemp(join(tmpdir(), "chaos-bytecode-"));
  try {
    await mkdir(join(dir, "src"));
    for (const name of ["GestureSeriesMarket", "ICosmicSignatureGame"]) {
      await copyFile(join(root, "src", name + ".sol"), join(dir, "src", name + ".sol"));
    }
    await writeFile(
      join(dir, "foundry.toml"),
      [
        "[profile.default]",
        'solc = "0.8.35"',
        'evm_version = "osaka"',
        "via_ir = true",
        "optimizer = true",
        "optimizer_runs = 1000000",
        "auto_detect_remappings = false",
        'remappings = ["forge-std/=lib/forge-std/src/"]',
        "",
      ].join("\n"),
    );
    execFileSync("forge", ["build", "--ast", "src/GestureSeriesMarket.sol"], {
      cwd: dir,
      env: { ...process.env, FOUNDRY_PROFILE: "default" },
      stdio: ["ignore", 2, 2],
    });
    return await foundryArtifact(join(dir, "out"), "GestureSeriesMarket");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const init = async (artifact, args) =>
  (await new ContractFactory(artifact.abi, artifact.creation).getDeployTransaction(...args)).data;

async function verify(provider) {
  const witness = await readJson(join(root, "deployment/arbitrum-bytecode.json"));
  assert.equal(witness.chainId, ARBITRUM.chainId);
  if (provider) await assertChain(provider, ARBITRUM);

  // All historical checks compare the complete bytecode, including compiler metadata.
  const legacy = await archivedSingleQuestion();
  const broadcast = await readJson(join(root, "broadcast/Deploy.s.sol/42161/run-latest.json"));
  assert.equal(broadcast.chain, ARBITRUM.chainId);
  assert.equal(broadcast.transactions.length, 1);
  assert.equal(broadcast.receipts.length, 1);
  const [entry] = broadcast.transactions;
  const [receipt] = broadcast.receipts;
  assert.equal(entry.transactionType, "CREATE");
  assert.equal(entry.contractName, legacy.name);
  assert.equal(BigInt(entry.transaction.chainId), BigInt(ARBITRUM.chainId));
  assert.equal(BigInt(entry.transaction.value), 0n);
  assert.equal(BigInt(receipt.status), 1n);
  assert.equal(receipt.transactionHash, witness.legacy.transaction);
  assert.equal(entry.hash, witness.legacy.transaction);
  assert.equal(receipt.blockHash, witness.legacy.blockHash);
  assert.equal(Number(receipt.blockNumber), witness.legacy.block);
  assert.equal(getAddress(entry.contractAddress), witness.legacy.address);
  assert.equal(getAddress(receipt.contractAddress), witness.legacy.address);
  assert.equal(
    getCreateAddress({ from: entry.transaction.from, nonce: entry.transaction.nonce }),
    witness.legacy.address,
  );
  assert.equal(getAddress(entry.arguments[0]), ARBITRUM.game);
  const legacyInput = await init(legacy, [ARBITRUM.game]);
  assert.ok(
    legacyInput === entry.transaction.input,
    "Archived single-question creation input differs from broadcast.",
  );
  const legacyRuntime = deployedRuntime(legacy, { game: ARBITRUM.game, cst: ARBITRUM.cst });
  assert.equal(
    keccak256(legacyRuntime),
    witness.legacy.runtimeHash,
    "Single-question runtime hash mismatch.",
  );

  // The original eight-question deployment used Hardhat, with its own metadata/source paths.
  execFileSync("pnpm", ["build:deployment"], { cwd: root, stdio: ["ignore", 2, 2] });
  const [source, market, vault, views] = await Promise.all([
    hardhatArtifact("V3OutcomeSource", "V3OutcomeSource"),
    hardhatArtifact("IndependentOutcomeMarket", "IndependentOutcomeMarket"),
    hardhatArtifact("OutcomeSettlementVault", "OutcomeSettlementVault", "IndependentOutcomeMarket"),
    hardhatArtifact("IndependentOutcomeMarket", "IndependentMarketViews"),
  ]);
  const baseline = await readJson(join(root, "deployment/arbitrum-round-2-baseline.json"));
  assert.equal(baseline.game, ARBITRUM.game);
  assert.equal(baseline.cst, ARBITRUM.cst);
  assert.equal(witness.source.address, SOURCE);
  const manifest = {
    ...ARBITRUM,
    contracts: { source: SOURCE },
    firstMarketRound: baseline.firstMarketRound,
    baseline: baseline.values,
  };
  const sourceInput = await init(source, constructorArgs("source", manifest));
  const marketInput = await init(market, constructorArgs("market", manifest));
  for (const [record, input] of [
    [witness.source, sourceInput],
    [witness.market, marketInput],
  ]) {
    assert.equal(getCreateAddress({ from: witness.deployer, nonce: record.nonce }), record.address);
    assert.equal(keccak256(input), record.inputHash, "Eight-question constructor input mismatch.");
  }
  const children = childrenOf(witness.market.address);
  assert.deepEqual(children, { vault: witness.vault.address, views: witness.views.address });
  const historical = [
    [witness.legacy, legacyRuntime, witness.legacy.block],
    [
      witness.source,
      deployedRuntime(source, {
        game: ARBITRUM.game,
        cst: ARBITRUM.cst,
        firstMarketRound: BigInt(baseline.firstMarketRound),
        baselineHash: baseline.constructorBaselineHash,
      }),
      witness.source.block,
    ],
    [
      witness.market,
      deployedRuntime(market, {
        cst: ARBITRUM.cst,
        source: SOURCE,
        settlementVault: children.vault,
        _marketViews: children.views,
      }),
      witness.market.block,
    ],
    [
      witness.vault,
      deployedRuntime(vault, { cst: ARBITRUM.cst, market: witness.market.address }),
      witness.market.block,
    ],
    [witness.views, deployedRuntime(views, {}), witness.market.block],
  ];
  for (const [record, code] of historical)
    assert.equal(keccak256(code), record.runtimeHash, `Runtime hash mismatch at ${record.address}`);
  const env = parseEnv(await readFile(join(root, "frontend/.env.production"), "utf8"));
  assert.equal(env.NEXT_PUBLIC_CHAIN_ID, String(ARBITRUM.chainId));
  assert.equal(getAddress(env.NEXT_PUBLIC_INDEPENDENT_MARKET_ADDRESS), witness.market.address);
  assert.equal(getAddress(env.NEXT_PUBLIC_INDEPENDENT_SOURCE_ADDRESS), SOURCE);

  const successor = await buildSuccessor();
  await reviewedSuccessorCreation(successor, { ...ARBITRUM, source: SOURCE }, witness.successor);
  if (provider) {
    for (const [record, creation] of [
      [witness.legacy, legacyInput],
      [witness.source, sourceInput],
      [witness.market, marketInput],
    ]) {
      const mined = await creationReceipt(provider, ARBITRUM.chainId, record.transaction, creation);
      assert.equal(getAddress(mined.contractAddress), record.address);
      assert.equal(mined.blockHash, record.blockHash);
      assert.equal(mined.blockNumber, record.block);
    }
    for (const [record, code, block] of historical) {
      assert.ok(
        (await provider.getCode(record.address, block)).toLowerCase() === code,
        `On-chain runtime mismatch at ${record.address}`,
      );
    }
    console.log(
      "Authenticated three historical creation transactions and five deployed runtimes at their Arbitrum receipt blocks.",
    );
  }
  console.log(
    "Verified historical creation/runtime witnesses and the V4 market, vault and helper build fingerprints.",
  );
}

async function main() {
  const args = process.argv.slice(2);
  assert.ok(
    !args.length || (args.length === 1 && args[0] === "--rpc"),
    "Use verify:bytecode [--rpc].",
  );
  const provider = args.length
    ? new JsonRpcProvider(process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc")
    : null;
  try {
    await verify(provider);
  } finally {
    provider?.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Provider errors may contain URLs or credentials.
    console.error(
      "Bytecode verification failed. Check the production build and witnesses, and the archive RPC when selected.",
    );
    process.exitCode = 1;
  });
}
