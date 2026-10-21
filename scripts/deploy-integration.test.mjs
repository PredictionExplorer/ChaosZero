import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { BrowserProvider, Contract, ContractFactory, Wallet, keccak256, toUtf8Bytes } from "ethers";
import { createHardhatRuntimeEnvironment } from "hardhat/hre";
import config from "../hardhat.config.js";
import { compileDeployment } from "./deploy-arbitrum.mjs";
import {
  CONTRACTS,
  buildHashes,
  confirmJournaled,
  deployStack,
  inspectContracts,
  loadManifest,
  publicManifest,
  saveManifest,
  validateGame,
  validateManifestContext,
  verifyStack,
} from "./deploy-runtime.mjs";

test(
  "production build deploys, resumes and verifies four contracts only on an in-process local chain",
  { timeout: 180_000 },
  async () => {
    const root = resolve(import.meta.dirname, "..");
    const artifacts = await compileDeployment();
    const hre = await createHardhatRuntimeEnvironment(
      {
        ...config,
        networks: { deploymentTest: { type: "edr-simulated", chainId: 31337, hardfork: "osaka" } },
      },
      { buildProfile: "production" },
      root,
    );
    const mockBuild = await hre.solidity.build(
      [resolve(root, "scripts/fixtures/DeploymentGame.sol")],
      { buildProfile: "production", quiet: true },
    );
    assert.equal(hre.solidity.isSuccessfulBuildResult(mockBuild), true);
    const mock = await hre.artifacts.readArtifact("DeploymentGame");
    const connection = await hre.network.create("deploymentTest");
    const provider = new BrowserProvider(connection.provider, undefined, { cacheTimeout: -1 });
    const temporary = await mkdtemp(join(tmpdir(), "chaos-deploy-integration-"));
    const file = join(temporary, "public-receipt.json");
    try {
      assert.equal((await provider.getNetwork()).chainId, 31337n);
      const signer = Wallet.createRandom().connect(provider);
      await provider.send("hardhat_setBalance", [signer.address, "0x56BC75E2D63100000"]);
      const token = "0x2222222222222222222222222222222222222222";
      await provider.send("hardhat_setCode", [token, "0x00"]);
      const game = await new ContractFactory(mock.abi, mock.bytecode, signer).deploy(token);
      await game.waitForDeployment();
      const expected = { chainId: 31337, game: await game.getAddress(), cst: token };
      const manifest = publicManifest({
        version: 1,
        ...expected,
        firstMarketRound: "3",
        deployer: signer.address,
        budgetWei: "1000000000000000000",
        baseline: {
          gestureCount: "1257",
          ethSpent: "50",
          cstBurned: "20",
          highestCstPaid: "10",
          enduranceDuration: "8",
          chronoDuration: "9",
          sameGesture: false,
        },
        evidenceHash: keccak256(toUtf8Bytes("local-only-test-evidence")),
        builds: buildHashes(artifacts),
        transactions: {},
        contracts: {},
        verified: [],
      });
      assert.equal(await validateGame(provider, expected, "3", manifest.baseline), 3n);
      await assert.rejects(
        validateGame(provider, { ...expected, cst: signer.address }, "3", manifest.baseline),
        { code: "GAME" },
      );
      await assert.rejects(
        validateGame(provider, expected, "3", { ...manifest.baseline, gestureCount: "1258" }),
        { code: "GAME" },
      );
      await assert.rejects(validateGame(provider, expected, "2", manifest.baseline), {
        code: "GAME",
      });
      // A frozen cycle-2 baseline can launch the engine after cycle 3 has ended.
      // The engine will follow the current cycle; elapsed cycles are not reopened.
      await (await game.setRound(4)).wait();
      assert.equal(await validateGame(provider, expected, "3", manifest.baseline), 4n);
      await (await game.setRound(3)).wait();
      await assert.rejects(validateGame(provider, expected, "4", manifest.baseline), {
        code: "GAME",
      });
      const startNonce = await provider.getTransactionCount(signer.address);
      await assert.rejects(
        deployStack({
          manifest: { ...manifest, budgetWei: "1" },
          provider,
          signer,
          artifacts,
          save: async () => assert.fail("over-budget transaction must not be journaled"),
        }),
        { code: "BUDGET" },
      );
      assert.equal(await provider.getTransactionCount(signer.address), startNonce);

      const unsent = structuredClone(manifest);
      await assert.rejects(
        deployStack({
          manifest: unsent,
          provider,
          signer,
          artifacts,
          save: async () => {
            throw new Error("simulated journal failure");
          },
        }),
      );
      assert.equal(await provider.getTransactionCount(signer.address), startNonce);
      await assert.rejects(
        deployStack({
          manifest: unsent,
          provider,
          signer,
          artifacts,
          save: async () => assert.fail("ambiguous journal must not be changed"),
        }),
        { code: "PENDING" },
      );

      await saveManifest(file, manifest, { exclusive: true });
      const save = (value) => saveManifest(file, value);
      const announcements = [];
      await deployStack({
        manifest,
        provider,
        signer,
        artifacts,
        save,
        emit: (message) => announcements.push(message),
      });
      assert.equal(await provider.getTransactionCount(signer.address), startNonce + 2);
      assert.equal(Object.keys(manifest.contracts).length, 4);
      assert.equal(announcements.length, 2);
      const source = new Contract(manifest.contracts.source, artifacts.source.abi, provider);
      assert.equal((await source.outcomeState(3)).open, true);
      assert.deepEqual(
        validateManifestContext(await loadManifest(file), expected, artifacts),
        manifest,
      );
      await assert.rejects(
        confirmJournaled(
          "source",
          { ...manifest, baseline: { ...manifest.baseline, chronoDuration: "10" } },
          provider,
          artifacts,
        ),
        { code: "MANIFEST" },
      );
      assert.throws(
        () =>
          validateManifestContext(
            { ...manifest, builds: { ...manifest.builds, source: keccak256("0x01") } },
            expected,
            artifacts,
          ),
        { code: "MANIFEST" },
      );

      // A public journal is not trusted to report signed gas reservations.
      const understated = structuredClone(manifest);
      understated.transactions.source.maxCostWei = "0";
      await assert.rejects(confirmJournaled("source", understated, provider, artifacts), {
        code: "MANIFEST",
      });
      const tooSmall = structuredClone(manifest);
      tooSmall.budgetWei = (
        Object.values(manifest.transactions).reduce((sum, tx) => sum + BigInt(tx.maxCostWei), 0n) -
        1n
      ).toString();
      assert.throws(() => publicManifest(tooSmall), { code: "MANIFEST" });
      const beforeResume = await provider.getTransactionCount(signer.address);
      await deployStack({ manifest, provider, signer, artifacts, save });
      assert.equal(await provider.getTransactionCount(signer.address), beforeResume);
      for (const role of ["source", "market"])
        await confirmJournaled(role, manifest, provider, artifacts);
      await inspectContracts(manifest, provider);
      const verified = [];
      await verifyStack({
        manifest,
        save,
        verify: async (args) => {
          assert.equal(args.provider, "etherscan");
          assert.notEqual(await provider.getCode(args.address), "0x");
          verified.push(args.contract);
          return true;
        },
      });
      assert.deepEqual(verified, Object.values(CONTRACTS));
      assert.equal(await provider.getTransactionCount(signer.address), beforeResume);
      const saved = await readFile(file, "utf8");
      assert.equal(saved.includes(signer.privateKey), false);
      assert.equal(saved.includes("rpcUrl"), false);
      assert.deepEqual(await readdir(temporary), ["public-receipt.json"]);
    } finally {
      provider.destroy();
      await connection.close();
      await rm(temporary, { recursive: true, force: true });
    }
  },
);
