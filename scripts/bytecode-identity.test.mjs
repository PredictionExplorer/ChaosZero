import assert from "node:assert/strict";
import test from "node:test";
import { AbiCoder, Interface, getCreateAddress } from "ethers";
import {
  childrenOf,
  creationReceipt,
  deployedRuntime,
  requireRuntime,
} from "./bytecode-identity.mjs";
import { inspectCreation } from "./prepare-game-funded-market.mjs";

const hash = "0x" + "12".repeat(32);
const blockHash = "0x" + "ab".repeat(32);
const deployer = "0x1000000000000000000000000000000000000001";
const market = getCreateAddress({ from: deployer, nonce: 3 });
const { vault, views } = childrenOf(market);
const expected = {
  chainId: 31337,
  game: "0x1000000000000000000000000000000000000011",
  cst: "0x1000000000000000000000000000000000000012",
  source: "0x1000000000000000000000000000000000000013",
};
const creation = "0x6000";
const transaction = {
  from: deployer,
  nonce: 3,
  chainId: 31337n,
  data: creation,
  to: null,
  value: 0n,
  hash,
  blockHash,
  blockNumber: 99,
};
const receipt = {
  contractAddress: market,
  from: deployer,
  to: null,
  status: 1,
  hash,
  blockHash,
  blockNumber: 99,
};
const provider = {
  getBlock: async () => ({ hash: blockHash }),
  getTransaction: async () => transaction,
  getTransactionReceipt: async () => receipt,
};

function template(name, keys) {
  return {
    name,
    runtime: "0x60" + "00".repeat(32 * keys.length) + "fea164736f6c6343000823000a",
    words: keys.map((key, i) => [key, [{ start: 1 + i * 32, length: 32 }]]),
  };
}

test("every occurrence of an immutable is filled; executable bytes and metadata are compared", async () => {
  const a = template("Vault", ["market", "cst"]);
  a.runtime += "00".repeat(32);
  a.words[0][1].push({ start: (a.runtime.length - 2) / 2 - 32, length: 32 });
  const bindings = { market, cst: expected.cst };
  const code = deployedRuntime(a, bindings);
  assert.equal(code.indexOf(market.slice(2).toLowerCase()), 28);
  assert(code.endsWith(market.slice(2).toLowerCase()));
  const chain = {
    getCode: async (address, block) => {
      assert.equal(address, vault);
      assert.equal(block, 99);
      return code;
    },
  };
  await requireRuntime(chain, 99, vault, a, bindings);
  for (const i of [0, 32, 65, 66, 100]) {
    const corrupt = Buffer.from(code.slice(2), "hex");
    corrupt[i] ^= 1;
    await assert.rejects(
      requireRuntime(
        { getCode: async () => "0x" + corrupt.toString("hex") },
        99,
        vault,
        a,
        bindings,
      ),
      /runtime mismatch/,
    );
  }
  assert.throws(() => deployedRuntime(a, { market }), /immutable bindings/);
  const invalid = [
    { start: -1, length: 32 },
    { start: 0, length: 32 },
    { start: 1, length: 4 },
    { start: 2, length: 32 },
    { start: 999, length: 32 },
  ];
  for (const site of invalid) {
    assert.throws(
      () =>
        deployedRuntime(
          { ...a, words: [...a.words, ["another", [site]]] },
          { ...bindings, another: 0n },
        ),
      /immutable (range|placeholder)/,
    );
  }
});

test("receipt inspection binds the supplied hash, sender, nonce, chain, input and canonical block", async () => {
  assert.equal(await creationReceipt(provider, 31337, hash, creation), receipt);
  for (const change of [
    { hash: blockHash },
    { blockHash: hash },
    { blockNumber: 98 },
    { from: market },
    { nonce: 4 },
    { to: market },
    { chainId: 42161n },
    { value: 1n },
    { data: "0x6001" },
  ]) {
    await assert.rejects(
      creationReceipt(
        { ...provider, getTransaction: async () => ({ ...transaction, ...change }) },
        31337,
        hash,
        creation,
      ),
    );
  }
  for (const change of [
    { hash: blockHash },
    { status: 0 },
    { contractAddress: views },
    { to: market },
    { from: views },
  ]) {
    await assert.rejects(
      creationReceipt(
        { ...provider, getTransactionReceipt: async () => ({ ...receipt, ...change }) },
        31337,
        hash,
        creation,
      ),
    );
  }
  await assert.rejects(
    creationReceipt({ ...provider, getBlock: async () => ({ hash }) }, 31337, hash, creation),
    /canonical/,
  );
});

test("successor inspection checks each constructor-created child's exact runtime and bindings at the receipt block", async () => {
  const artifacts = {
    market: template("Market", ["game", "cst", "source", "settlementVault", "_marketViews"]),
    vault: template("Vault", ["market", "cst"]),
    views: template("Views", []),
  };
  const code = {
    [market]: deployedRuntime(artifacts.market, {
      game: expected.game,
      cst: expected.cst,
      source: expected.source,
      settlementVault: vault,
      _marketViews: views,
    }),
    [vault]: deployedRuntime(artifacts.vault, { market, cst: expected.cst }),
    [views]: artifacts.views.runtime,
  };
  const getters = {
    game: expected.game,
    cst: expected.cst,
    source: expected.source,
    settlementVault: vault,
    marketViews: views,
    market,
    CYCLE_FUNDING: 8000n * 10n ** 18n,
  };
  const abi = new Interface(
    Object.keys(getters).map(
      (n) => `function ${n}() view returns (${n === "CYCLE_FUNDING" ? "uint256" : "address"})`,
    ),
  );
  const chain = {
    ...provider,
    send: async (method) => {
      assert.equal(method, "eth_chainId");
      return "0x7a69";
    },
    getCode: async (a, b) => {
      assert.equal(b, 99);
      return code[a];
    },
    call: async (tx) => {
      assert.equal(tx.blockTag, 99);
      const f = abi.getFunction(tx.data);
      return AbiCoder.defaultAbiCoder().encode(f.outputs, [getters[f.name]]);
    },
  };
  const info = await inspectCreation(chain, expected, creation, hash, artifacts);
  assert.deepEqual(
    [info.market, info.vault, info.views, info.blockNumber],
    [market, vault, views, 99],
  );
  for (const addr of [market, vault, views])
    await assert.rejects(
      inspectCreation(
        {
          ...chain,
          getCode: (a, b) => (a === addr ? Promise.resolve("0x00") : chain.getCode(a, b)),
        },
        expected,
        creation,
        hash,
        artifacts,
      ),
      /runtime mismatch/,
    );
  getters.settlementVault = views;
  await assert.rejects(
    inspectCreation(chain, expected, creation, hash, artifacts),
    /Unexpected successor identity/,
  );
  getters.settlementVault = vault;
  getters.market = deployer;
  await assert.rejects(
    inspectCreation(chain, expected, creation, hash, artifacts),
    /Unexpected claim vault/,
  );
});
