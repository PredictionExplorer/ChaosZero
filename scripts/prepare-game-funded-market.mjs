import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Contract, ContractFactory, JsonRpcProvider, getAddress, keccak256 } from "ethers";
import { ARBITRUM, assertChain, assertProductionImplementation } from "./deploy-runtime.mjs";

export const SOURCE = "0x099c29624E05506582655417344A17FB71c9d138";
const BASELINE_HASH = "0x270bdafae80631bde00ccdad3a78ca455a073a900c3d91fb7ead3d0b870f5891";

/** Match the mined creation input, which also binds both constructor-created children. */
export async function inspectCreation(provider, expected, creation, hash) {
  assert.match(hash, /^0x[0-9a-f]{64}$/i, "Expected a deployment transaction hash.");
  const [transaction, receipt] = await Promise.all([
    provider.getTransaction(hash),
    provider.getTransactionReceipt(hash),
  ]);
  assert.ok(
    transaction && receipt?.status === 1 && receipt.contractAddress,
    "Creation is unconfirmed or failed.",
  );
  assert.ok(
    transaction.to === null &&
      transaction.chainId === BigInt(expected.chainId) &&
      transaction.value === 0n,
    "Expected a contract creation on the reviewed chain.",
  );
  assert.equal(
    keccak256(transaction.data),
    keccak256(creation),
    "Creation code or constructor arguments differ from the local production build.",
  );
  const address = getAddress(receipt.contractAddress);
  const market = new Contract(
    address,
    [
      "function game() view returns(address)",
      "function cst() view returns(address)",
      "function source() view returns(address)",
      "function settlementVault() view returns(address)",
      "function marketViews() view returns(address)",
      "function CYCLE_FUNDING() view returns(uint256)",
    ],
    provider,
  );
  const [game, cst, source, vault, views, grant] = await Promise.all([
    market.game(),
    market.cst(),
    market.source(),
    market.settlementVault(),
    market.marketViews(),
    market.CYCLE_FUNDING(),
  ]);
  assert.deepEqual(
    [game, cst, source, grant],
    [expected.game, expected.cst, expected.source, 8000n * 10n ** 18n],
    "Unexpected successor identity or cycle amount.",
  );
  const reserve = new Contract(
    vault,
    ["function market() view returns(address)", "function cst() view returns(address)"],
    provider,
  );
  const [vaultMarket, vaultToken, helperCode] = await Promise.all([
    reserve.market(),
    reserve.cst(),
    provider.getCode(views),
  ]);
  assert.deepEqual([vaultMarket, vaultToken], [address, expected.cst], "Unexpected claim vault.");
  assert.notEqual(helperCode, "0x", "Read helper is missing.");
  return { market: address, vault, views, transactionHash: hash, blockNumber: receipt.blockNumber };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1) throw Error("Expected at most one public deployment hash.");
  execFileSync("forge", ["build", "src/GameFundedOutcomeMarket.sol"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: { ...process.env, FOUNDRY_PROFILE: "default" },
    stdio: ["ignore", 2, 2],
  });
  const provider = new JsonRpcProvider(
    process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
  );
  try {
    const artifact = JSON.parse(
      await readFile(
        new URL("../out/GameFundedOutcomeMarket.sol/GameFundedOutcomeMarket.json", import.meta.url),
        "utf8",
      ),
    );
    const expected = { ...ARBITRUM, source: SOURCE };
    await assertChain(provider, expected);
    if (!args.length) await assertProductionImplementation(provider, expected);
    const source = new Contract(
      SOURCE,
      [
        "function game() view returns(address)",
        "function cst() view returns(address)",
        "function baselineHash() view returns(bytes32)",
      ],
      provider,
    );
    assert.deepEqual(
      await Promise.all([source.game(), source.cst(), source.baselineHash()]),
      [expected.game, expected.cst, BASELINE_HASH],
      "The deployed outcome adapter failed validation.",
    );
    const creation = (
      await new ContractFactory(artifact.abi, artifact.bytecode.object).getDeployTransaction(
        expected.cst,
        SOURCE,
        expected.game,
      )
    ).data;
    const output = args.length
      ? await inspectCreation(provider, expected, creation, args[0])
      : { chainId: expected.chainId, value: "0", data: creation };
    process.stdout.write(
      JSON.stringify({ ...expected, creationHash: keccak256(creation), ...output }, null, 2) + "\n",
    );
  } finally {
    provider.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // RPC errors can embed the endpoint. Keep diagnostics independent of provider input.
    console.error(
      "Successor preparation or inspection failed. Check the production build, Arbitrum RPC, deployment hash and pinned contract identities.",
    );
    process.exitCode = 1;
  });
}
