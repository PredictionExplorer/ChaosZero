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
  requireCanonicalBlock,
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

export async function inspectHistoricalStack(provider, { transaction, creation, runtimes }) {
  const mined = await creationReceipt(
    provider,
    ARBITRUM.chainId,
    transaction.transaction,
    creation,
  );
  assert.equal(getAddress(mined.contractAddress), transaction.address);
  assert.equal(mined.blockHash, transaction.blockHash);
  assert.equal(mined.blockNumber, transaction.block);
  for (const [record, code] of runtimes) {
    assert.ok(
      (await provider.getCode(record.address, mined.blockNumber)).toLowerCase() === code,
      `On-chain runtime mismatch at ${record.address}`,
    );
  }
  await requireCanonicalBlock(provider, mined.blockNumber, mined.blockHash);
}

let stage = "argument validation";

async function verify(provider) {
  stage = "historical witness loading";
  const witness = await readJson(join(root, "deployment/arbitrum-bytecode.json"));
  assert.equal(witness.chainId, ARBITRUM.chainId);
  if (provider) {
    stage = "archive RPC chain verification";
    await assertChain(provider, ARBITRUM);
  }

  // All historical checks compare the complete bytecode, including compiler metadata.
  stage = "archived single-question build";
  const legacy = await archivedSingleQuestion();
  stage = "archived single-question transaction and runtime witnesses";
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
  stage = "original eight-question build";
  execFileSync("pnpm", ["build:deployment"], { cwd: root, stdio: ["ignore", 2, 2] });
  const [source, market, vault, views] = await Promise.all([
    hardhatArtifact("V3OutcomeSource", "V3OutcomeSource"),
    hardhatArtifact("IndependentOutcomeMarket", "IndependentOutcomeMarket"),
    hardhatArtifact("OutcomeSettlementVault", "OutcomeSettlementVault", "IndependentOutcomeMarket"),
    hardhatArtifact("IndependentOutcomeMarket", "IndependentMarketViews"),
  ]);
  stage = "eight-question constructor and immutable witnesses";
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
    {
      label: "single-question market",
      transaction: witness.legacy,
      creation: legacyInput,
      runtimes: [[witness.legacy, legacyRuntime]],
    },
    {
      label: "eight-question outcome source",
      transaction: witness.source,
      creation: sourceInput,
      runtimes: [
        [
          witness.source,
          deployedRuntime(source, {
            game: ARBITRUM.game,
            cst: ARBITRUM.cst,
            firstMarketRound: BigInt(baseline.firstMarketRound),
            baselineHash: baseline.constructorBaselineHash,
          }),
        ],
      ],
    },
    {
      label: "eight-question market and children",
      transaction: witness.market,
      creation: marketInput,
      runtimes: [
        [
          witness.market,
          deployedRuntime(market, {
            cst: ARBITRUM.cst,
            source: SOURCE,
            settlementVault: children.vault,
            _marketViews: children.views,
          }),
        ],
        [
          witness.vault,
          deployedRuntime(vault, { market: witness.market.address, cst: ARBITRUM.cst }),
        ],
        [witness.views, deployedRuntime(views, {})],
      ],
    },
  ];
  for (const { runtimes } of historical) {
    for (const [record, code] of runtimes) {
      assert.equal(
        keccak256(code),
        record.runtimeHash,
        `Runtime hash mismatch at ${record.address}`,
      );
    }
  }
  stage = "production frontend identity";
  const env = parseEnv(await readFile(join(root, "frontend/.env.production"), "utf8"));
  assert.equal(env.NEXT_PUBLIC_CHAIN_ID, String(ARBITRUM.chainId));
  assert.equal(getAddress(env.NEXT_PUBLIC_INDEPENDENT_MARKET_ADDRESS), witness.market.address);
  assert.equal(getAddress(env.NEXT_PUBLIC_INDEPENDENT_SOURCE_ADDRESS), SOURCE);

  stage = "V4 build";
  const successor = await buildSuccessor();
  stage = "V4 candidate fingerprints";
  await reviewedSuccessorCreation(successor, { ...ARBITRUM, source: SOURCE }, witness.successor);
  if (provider) {
    for (const stack of historical) {
      stage = "archive RPC verification of " + stack.label;
      await inspectHistoricalStack(provider, stack);
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
  stage = "archive RPC setup";
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
    console.error(`Bytecode verification failed during ${stage}.`);
    process.exitCode = 1;
  });
}
