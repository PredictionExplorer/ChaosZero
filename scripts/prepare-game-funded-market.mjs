import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { Contract, JsonRpcProvider, getAddress, keccak256 } from "ethers";
import { ARBITRUM, assertChain, assertProductionImplementation } from "./deploy-runtime.mjs";

import {
  buildSuccessor,
  childrenOf,
  creationReceipt,
  readJson,
  reviewedSuccessorCreation,
  requireRuntime,
  requireCanonicalBlock,
} from "./bytecode-identity.mjs";

export const SOURCE = "0x099c29624E05506582655417344A17FB71c9d138";
const BASELINE_HASH = "0x270bdafae80631bde00ccdad3a78ca455a073a900c3d91fb7ead3d0b870f5891";

/** Match the mined creation input, which also binds both constructor-created children. */
export async function inspectCreation(provider, expected, creation, hash, artifacts) {
  await assertChain(provider, expected);
  const receipt = await creationReceipt(provider, expected.chainId, hash, creation);
  artifacts ??= await buildSuccessor();
  const address = getAddress(receipt.contractAddress);
  const blockTag = receipt.blockNumber;
  const { vault, views } = childrenOf(address);
  await Promise.all([
    requireRuntime(provider, blockTag, address, artifacts.market, {
      game: expected.game,
      cst: expected.cst,
      source: expected.source,
      settlementVault: vault,
      _marketViews: views,
    }),
    requireRuntime(provider, blockTag, vault, artifacts.vault, {
      market: address,
      cst: expected.cst,
    }),
    requireRuntime(provider, blockTag, views, artifacts.views, {}),
  ]);
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
  const [game, cst, source, reportedVault, reportedViews, grant] = await Promise.all([
    market.game({ blockTag }),
    market.cst({ blockTag }),
    market.source({ blockTag }),
    market.settlementVault({ blockTag }),
    market.marketViews({ blockTag }),
    market.CYCLE_FUNDING({ blockTag }),
  ]);
  assert.deepEqual(
    [game, cst, source, reportedVault, reportedViews, grant],
    [expected.game, expected.cst, expected.source, vault, views, 8000n * 10n ** 18n],
    "Unexpected successor identity or cycle amount.",
  );
  const reserve = new Contract(
    vault,
    ["function market() view returns(address)", "function cst() view returns(address)"],
    provider,
  );
  const [vaultMarket, vaultToken] = await Promise.all([
    reserve.market({ blockTag }),
    reserve.cst({ blockTag }),
  ]);
  assert.deepEqual([vaultMarket, vaultToken], [address, expected.cst], "Unexpected claim vault.");
  await requireCanonicalBlock(provider, blockTag, receipt.blockHash);
  return { market: address, vault, views, transactionHash: hash, blockNumber: receipt.blockNumber };
}

let stage = "argument validation";

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1) throw Error("Expected at most one public deployment hash.");
  stage = "V4 build";
  const artifacts = await buildSuccessor();
  stage = "chain and outcome-source verification";
  const provider = new JsonRpcProvider(
    process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
  );
  try {
    const expected = { ...ARBITRUM, source: SOURCE };
    await assertChain(provider, expected);
    if (!args.length) await assertProductionImplementation(provider, expected);
    const witness = await readJson(
      new URL("../deployment/arbitrum-bytecode.json", import.meta.url),
    );
    assert.equal(
      keccak256(await provider.getCode(SOURCE)),
      witness.source.runtimeHash,
      "Unexpected outcome source code.",
    );
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
    stage = "V4 build fingerprint verification";
    const creation = await reviewedSuccessorCreation(artifacts, expected, witness.successor);
    stage = "mined receipt, immutable bindings and runtime verification";
    const output = args.length
      ? await inspectCreation(provider, expected, creation, args[0], artifacts)
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
    console.error(`Successor preparation or inspection failed during ${stage}.`);
    process.exitCode = 1;
  });
}
