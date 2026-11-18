import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ContractFactory,
  keccak256,
  getAddress,
  getBytes,
  getCreateAddress,
  hexlify,
  toBeHex,
  toQuantity,
  zeroPadValue,
} from "ethers";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

function compilerArtifact(name, artifact, ast, runtime, creation, refs, links, runtimeLinks) {
  // No release contract uses external library linking. Require a reviewed address map if that changes.
  assert.ok(
    !Object.keys(links).length && !Object.keys(runtimeLinks).length,
    `${name}: unresolved libraries`,
  );
  assert.ok(getBytes(runtime).length && getBytes(creation).length, `${name}: missing bytecode`);
  const contract = ast.nodes.find((n) => n.nodeType === "ContractDefinition" && n.name === name);
  assert.ok(contract, `${name}: missing compiler AST`);
  const declarations = contract.nodes.filter(
    (n) => n.nodeType === "VariableDeclaration" && n.mutability === "immutable",
  );
  const words = Object.entries(refs).map(([id, sites]) => {
    const declaration = declarations.find((n) => n.id === Number(id));
    assert.ok(declaration && sites.length, `${name}: unknown immutable reference`);
    return [declaration.name, sites];
  });
  assert.equal(words.length, declarations.length, `${name}: incomplete immutable layout`);
  return { name, abi: artifact.abi, creation, runtime, words };
}

export async function foundryArtifact(dir, name) {
  const a = await readJson(join(dir, `${name}.sol`, `${name}.json`));
  const deployed = a.deployedBytecode;
  return compilerArtifact(
    name,
    a,
    a.ast,
    deployed.object,
    a.bytecode.object,
    deployed.immutableReferences ?? {},
    a.bytecode.linkReferences,
    deployed.linkReferences,
  );
}

/** Read the exact compilation job embedding the child, including its source-unit metadata. */
export async function hardhatArtifact(source, name, compilationRoot = source) {
  const dir = join(root, ".local/hardhat-artifacts");
  const parent = await readJson(
    join(dir, "src", `${compilationRoot}.sol`, `${compilationRoot}.json`),
  );
  const build = await readJson(join(dir, "build-info", parent.buildInfoId + ".output.json"));
  const sourceUnit = `project/src/${source}.sol`;
  const a = build.output.contracts[sourceUnit][name];
  const { bytecode, deployedBytecode } = a.evm;
  return compilerArtifact(
    name,
    a,
    build.output.sources[sourceUnit].ast,
    "0x" + deployedBytecode.object,
    "0x" + bytecode.object,
    deployedBytecode.immutableReferences ?? {},
    bytecode.linkReferences,
    deployedBytecode.linkReferences,
  );
}

export async function buildSuccessor() {
  const out = join(root, ".local/bytecode-foundry");
  // AST output identifies each immutable by name. Its compiler-local numeric ID is not stable.
  execFileSync(
    "forge",
    [
      "build",
      "--ast",
      "--out",
      out,
      "--cache-path",
      join(root, ".local/bytecode-cache"),
      "src/GameFundedOutcomeMarket.sol",
    ],
    {
      cwd: root,
      env: { ...process.env, FOUNDRY_PROFILE: "default" },
      stdio: ["ignore", 2, 2],
    },
  );
  const [market, vault, views] = await Promise.all(
    ["GameFundedOutcomeMarket", "OutcomeSettlementVault", "GameFundedMarketViews"].map((n) =>
      foundryArtifact(out, n),
    ),
  );
  return { market, vault, views };
}

/** Verify the release target before emitting any unsigned creation data or inspecting a receipt. */
export async function reviewedSuccessorCreation(artifacts, expected, witness) {
  const creation = (
    await new ContractFactory(artifacts.market.abi, artifacts.market.creation).getDeployTransaction(
      expected.cst,
      expected.source,
      expected.game,
    )
  ).data;
  assert.equal(
    keccak256(creation),
    witness.unsignedInputHash,
    "Unsigned V4 initcode fingerprint changed.",
  );
  for (const [role, artifact] of Object.entries(artifacts)) {
    assert.equal(
      keccak256(artifact.runtime),
      witness.runtimeTemplateHashes[role],
      `V4 ${role} runtime template changed.`,
    );
  }
  return creation;
}

/** Substitute only compiler-declared, zero-filled immutable slots. Metadata and all other bytes remain in the comparison. */
export function deployedRuntime({ name, runtime, words }, bindings) {
  const bytes = getBytes(runtime).slice();
  assert.deepEqual(
    words.map(([key]) => key).sort(),
    Object.keys(bindings).sort(),
    `${name}: immutable bindings`,
  );
  const used = new Set();
  for (const [key, sites] of words) {
    const value = getBytes(zeroPadValue(toBeHex(BigInt(bindings[key])), 32));
    for (const { start, length } of sites) {
      assert.ok(
        Number.isSafeInteger(start) &&
          start >= 0 &&
          length === 32 &&
          start + length <= bytes.length,
        `${name}: invalid immutable range`,
      );
      for (let i = start; i < start + length; i++) {
        assert.ok(!used.has(i) && bytes[i] === 0, `${name}: invalid immutable placeholder`);
        used.add(i);
      }
      bytes.set(value, start);
    }
  }
  return hexlify(bytes);
}

export function childrenOf(market) {
  return {
    vault: getCreateAddress({ from: market, nonce: 1 }),
    views: getCreateAddress({ from: market, nonce: 2 }),
  };
}

export async function requireRuntime(provider, block, address, artifact, bindings) {
  const observed = await provider.getCode(address, block);
  assert.equal(
    observed.toLowerCase() === deployedRuntime(artifact, bindings),
    true,
    `${artifact.name}: runtime mismatch at ${getAddress(address)}`,
  );
}

/** A fresh JSON-RPC read; ethers can cache getBlock(height) across both ends of a short inspection. */
export async function requireCanonicalBlock(provider, height, hash) {
  const quantity = toQuantity(height);
  const block = await provider.send("eth_getBlockByNumber", [quantity, false]);
  assert.ok(
    block?.number?.toLowerCase() === quantity && block?.hash?.toLowerCase() === hash.toLowerCase(),
    "Creation block is no longer canonical.",
  );
}

/** Read only. Tie both RPC responses to the requested CREATE and to a canonical block. */
export async function creationReceipt(provider, chainId, hash, creation) {
  assert.match(hash, /^0x[0-9a-f]{64}$/i, "Expected a deployment transaction hash.");
  const [tx, receipt] = await Promise.all([
    provider.getTransaction(hash),
    provider.getTransactionReceipt(hash),
  ]);
  assert.ok(
    tx && receipt?.status === 1 && receipt.contractAddress,
    "Creation is unconfirmed or failed.",
  );
  assert.ok(
    Number.isSafeInteger(receipt.blockNumber) &&
      receipt.blockNumber >= 0 &&
      /^0x[0-9a-f]{64}$/i.test(receipt.blockHash) &&
      tx.hash.toLowerCase() === hash.toLowerCase() &&
      receipt.hash.toLowerCase() === hash.toLowerCase() &&
      tx.blockNumber === receipt.blockNumber &&
      tx.blockHash === receipt.blockHash &&
      tx.to === null &&
      receipt.to === null &&
      tx.chainId === BigInt(chainId) &&
      tx.value === 0n &&
      getAddress(tx.from) === getAddress(receipt.from),
    "Expected a mined contract creation on the reviewed chain.",
  );
  assert.equal(
    getAddress(receipt.contractAddress),
    getCreateAddress({ from: tx.from, nonce: tx.nonce }),
    "Incorrect CREATE address.",
  );
  assert.equal(
    tx.data.toLowerCase() === creation.toLowerCase(),
    true,
    "Creation code or constructor arguments differ from the local production build.",
  );
  await requireCanonicalBlock(provider, receipt.blockNumber, receipt.blockHash);
  return receipt;
}
