import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { createHardhatRuntimeEnvironment } from "hardhat/hre";
import config, { productionCompiler } from "../hardhat.config.js";

const require = createRequire(import.meta.url);
const fromHardhat = createRequire(require.resolve("hardhat/package.json"));
const fromVerify = createRequire(require.resolve("@nomicfoundation/hardhat-verify/package.json"));
const helpersPath = fromHardhat.resolve("@nomicfoundation/hardhat-zod-utils");
const fromHelpers = createRequire(helpersPath);
const { z } = fromHardhat("zod/v4");
const helpers = await import(pathToFileURL(helpersPath));
const rpc = await import(
  pathToFileURL(fromHardhat.resolve("@nomicfoundation/hardhat-zod-utils/rpc"))
);

test("tooling uses native Zod 4 across compiler, verification plugin and config/RPC helpers", () => {
  for (const consumer of [fromHardhat, fromVerify, fromHelpers]) {
    assert.equal(consumer("zod").ZodType, z.ZodType);
  }
  assert.ok(helpers.configurationVariableSchema instanceof z.ZodType);
  const variable = {
    _type: "ResolvedConfigurationVariable",
    get() {
      return "test";
    },
    getUrl() {},
    getBigInt() {},
    getHexString() {},
  };
  assert.equal(helpers.resolvedConfigurationVariableSchema.parse(variable).get(), "test");
  assert.equal(
    helpers.resolvedConfigurationVariableSchema.safeParse({ ...variable, get: 7 }).success,
    false,
  );
});

test("Hardhat resolves the release compiler profile and independent HTTP header maps", async () => {
  const headers = { "X-Test-Network": "local" };
  const hre = await createHardhatRuntimeEnvironment({
    ...config,
    networks: { localReader: { type: "http", url: "http://127.0.0.1:1", httpHeaders: headers } },
    chainDescriptors: {
      42161: { name: "Arbitrum", hardforkHistory: { london: { blockNumber: 1 } } },
    },
  });
  assert.equal(
    hre.config.solidity.profiles.production.compilers[0].version,
    productionCompiler.version,
  );
  assert.deepEqual(hre.config.networks.localReader.httpHeaders, headers);
  assert.equal(hre.config.verify.etherscan.enabled, false);
});

test("invalid release settings return Hardhat config errors with full paths", async () => {
  for (const [override, path] of [
    [
      {
        networks: {
          localReader: { type: "http", url: "http://localhost", httpHeaders: { bad: 9 } },
        },
      },
      "networks.localReader.httpHeaders.bad",
    ],
    [{ verify: { etherscan: { enabled: true } } }, "verify.etherscan.apiKey"],
    [
      { solidity: { profiles: { default: productionCompiler, production: { version: 7 } } } },
      "solidity.profiles.production.version",
    ],
    [
      {
        chainDescriptors: {
          42161: { name: "Arbitrum", hardforkHistory: { london: { blockNumber: -1 } } },
        },
      },
      "chainDescriptors.42161.hardforkHistory.london.blockNumber",
    ],
  ]) {
    await assert.rejects(
      () => createHardhatRuntimeEnvironment({ ...config, ...override }),
      (error) => error.message.includes("HHE15") && error.message.includes("config." + path),
    );
  }
  const choice = z.object({
    conflicting: helpers.incompatibleFieldType("Cannot combine these fields"),
  });
  assert.deepEqual(helpers.validateUserConfigZodType({}, choice), []);
  assert.deepEqual(helpers.validateUserConfigZodType({ conflicting: 1 }, choice), [
    { path: ["conflicting"], message: "Cannot combine these fields" },
  ]);
});

test("RPC parameters retain quantity and byte transformations and reject invalid values", () => {
  const [tx] = rpc.validateParams(
    [{ from: "0x0000000000000000000000000000000000000001", nonce: "0x5", data: "0xaabb" }],
    rpc.rpcTransactionRequest,
  );
  assert.equal(tx.from.length, 20);
  assert.equal(tx.from[19], 1);
  assert.equal(tx.nonce, 5n);
  assert.deepEqual(Array.from(tx.data), [0xaa, 0xbb]);
  assert.throws(() => rpc.validateParams(["five"], rpc.rpcQuantity));
  assert.throws(() => rpc.validateParams([], rpc.rpcQuantity));
});
