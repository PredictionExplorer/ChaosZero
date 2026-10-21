import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  AbiCoder,
  JsonRpcProvider,
  Wallet,
  formatEther,
  keccak256,
  parseEther,
  toUtf8Bytes,
} from "ethers";
import {
  ARBITRUM,
  CONTRACTS,
  DeploymentError,
  assertChain,
  assertProductionImplementation,
  baselineValues,
  buildHashes,
  confirmJournaled,
  deployStack,
  fail,
  hiddenPrompt,
  inspectContracts,
  loadManifest,
  protectOutput,
  publicManifest,
  safeError,
  saveManifest,
  validateGame,
  validateManifestContext,
  validateRpc,
  validateRuntime,
  verifyStack,
} from "./deploy-runtime.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const BASELINE_FILE = resolve(ROOT, "deployment/arbitrum-round-2-baseline.json");
export const REVIEWED_BASELINE_HASH =
  "0x270bdafae80631bde00ccdad3a78ca455a073a900c3d91fb7ead3d0b870f5891";

export function parseArguments(args) {
  if (
    args.length < 1 ||
    args.length > 2 ||
    !["deploy", "resume", "verify"].includes(args[0]) ||
    (args[1] && (args[1].startsWith("-") || !args[1].endsWith(".json")))
  )
    fail("ARGUMENTS");
  return {
    mode: args[0],
    manifestPath: resolve(ROOT, args[1] ?? ".local/arbitrum-deployment.json"),
  };
}

export function validateBaselineEvidence(raw) {
  const evidence = JSON.parse(raw);
  if (
    evidence.chainId !== ARBITRUM.chainId ||
    evidence.game.toLowerCase() !== ARBITRUM.game.toLowerCase() ||
    evidence.cst.toLowerCase() !== ARBITRUM.cst.toLowerCase() ||
    evidence.baselineRound !== "2" ||
    evidence.firstMarketRound !== "3"
  )
    fail("MANIFEST");
  const baseline = baselineValues(evidence.values);
  const encodedHash = keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "tuple(uint256,uint256,uint256,uint256,uint256,uint256,bool)"],
      [ARBITRUM.game, 2n, Object.values(baseline)],
    ),
  );
  if (
    encodedHash !== REVIEWED_BASELINE_HASH ||
    evidence.constructorBaselineHash !== REVIEWED_BASELINE_HASH
  )
    fail("MANIFEST");
  return {
    firstMarketRound: evidence.firstMarketRound,
    baseline,
    evidenceHash: keccak256(toUtf8Bytes(raw)),
  };
}

export async function readBaseline() {
  return validateBaselineEvidence(await readFile(BASELINE_FILE, "utf8"));
}

export async function compileDeployment() {
  const [{ createHardhatRuntimeEnvironment }, { default: config }] = await Promise.all([
    import("hardhat/hre"),
    import("../hardhat.config.js"),
  ]);
  const hre = await createHardhatRuntimeEnvironment(config, { buildProfile: "production" }, ROOT);
  const roots = await hre.solidity.getRootFilePaths();
  const result = await hre.solidity.build(roots, { buildProfile: "production", quiet: true });
  if (!hre.solidity.isSuccessfulBuildResult(result)) fail("BUILD");
  const artifacts = Object.fromEntries(
    await Promise.all(
      Object.entries(CONTRACTS).map(async ([role, name]) => [
        role,
        await hre.artifacts.readArtifact(name),
      ]),
    ),
  );
  if (
    Object.values(artifacts).some(
      (artifact) =>
        (artifact.deployedBytecode.length - 2) / 2 > 24_576 ||
        (artifact.bytecode.length - 2) / 2 > 49_152,
    )
  )
    fail("BUILD");
  return artifacts;
}

async function makeVerifier(rpcUrl, apiKey) {
  const [{ createHardhatRuntimeEnvironment }, { default: config }, { verifyContract }] =
    await Promise.all([
      import("hardhat/hre"),
      import("../hardhat.config.js"),
      import("@nomicfoundation/hardhat-verify/verify"),
    ]);
  // This object exists only in process memory. The private signing key never
  // enters Hardhat at all. Etherscan V2 uses one API key for Arbiscan as well.
  const hre = await createHardhatRuntimeEnvironment(
    {
      ...config,
      networks: {
        arbitrum: {
          type: "http",
          chainId: ARBITRUM.chainId,
          chainType: "generic",
          url: rpcUrl,
          accounts: [],
          timeout: 60_000,
        },
      },
      verify: { ...config.verify, etherscan: { enabled: true, apiKey } },
    },
    { network: "arbitrum", buildProfile: "production" },
    ROOT,
  );
  return (parameters) => verifyContract(parameters, hre);
}

/** This entrypoint is interactive on purpose. No signing or explorer secrets are
 * accepted as options, environment variables, stdin pipes or config files.
 */
export async function main(args = process.argv.slice(2)) {
  const guarded = protectOutput();
  const emit = (text) => guarded.write(`${text}\n`);
  const abort = new AbortController();
  let lock, lockPath, provider;
  const releaseLockOnExit = () => {
    if (lock && lockPath) {
      try {
        unlinkSync(lockPath);
      } catch {}
    }
  };
  const onSignal = () => {
    abort.abort();
    process.stdin.setRawMode?.(false);
    releaseLockOnExit();
    emit(
      "Cancelled. Public deployment receipts are retained; use resume or verify after checking them.",
    );
    process.exit(130);
  };
  const onUnexpected = () => {
    process.stdin.setRawMode?.(false);
    releaseLockOnExit();
    emit(safeError(undefined));
    process.exit(1);
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(signal, onSignal);
  process.once("uncaughtException", onUnexpected);
  process.once("unhandledRejection", onUnexpected);
  const prompt = (label) => hiddenPrompt(label, { write: guarded.write, signal: abort.signal });
  try {
    validateRuntime();
    const { mode, manifestPath } = parseArguments(args);
    if (!process.stdin.isTTY || !process.stdout.isTTY) fail("TTY");
    emit("Building the pinned production contracts before requesting any credentials...");
    let artifacts;
    try {
      artifacts = await compileDeployment();
    } catch {
      fail("BUILD");
    }
    const baseline = await readBaseline();
    let manifest = await loadManifest(manifestPath);
    if (mode === "deploy" && manifest) fail("EXISTS");
    if (mode !== "deploy" && !manifest) fail("MANIFEST");
    if (manifest) {
      manifest = validateManifestContext(manifest, ARBITRUM, artifacts);
      if (
        manifest.evidenceHash !== baseline.evidenceHash ||
        JSON.stringify(manifest.baseline) !== JSON.stringify(baseline.baseline) ||
        manifest.firstMarketRound !== baseline.firstMarketRound
      )
        fail("MANIFEST");
    }
    await mkdir(dirname(manifestPath), { recursive: true });
    lockPath = `${manifestPath}.lock`;
    try {
      lock = await open(lockPath, "wx", 0o600);
    } catch {
      fail("JOURNAL");
    }
    // Recheck after acquiring the lock, closing the concurrent invocation race.
    const lockedManifest = await loadManifest(manifestPath);
    if (mode === "deploy" && lockedManifest) fail("EXISTS");
    if (mode !== "deploy" && JSON.stringify(lockedManifest) !== JSON.stringify(manifest))
      fail("MANIFEST");
    let rpcUrl = validateRpc(
      (await prompt("Arbitrum One HTTPS RPC URL (hidden; Enter uses public RPC): ")) ||
        "https://arb1.arbitrum.io/rpc",
    );
    provider = new JsonRpcProvider(rpcUrl, undefined, { batchMaxCount: 1, cacheTimeout: -1 });
    await assertChain(provider, ARBITRUM);
    if (!manifest?.transactions.source)
      await validateGame(provider, ARBITRUM, baseline.firstMarketRound, baseline.baseline);
    else if (mode !== "verify") await assertProductionImplementation(provider, ARBITRUM);
    if (mode !== "verify") {
      let privateKey = await prompt("Deployment private key (hidden, held only in memory): ");
      if (!/^(?:0x)?[a-fA-F0-9]{64}$/.test(privateKey)) fail("SIGNER");
      let signer;
      try {
        signer = new Wallet(privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`, provider);
      } catch {
        fail("SIGNER");
      }
      privateKey = "";
      if (!manifest) {
        const budget = await prompt("Maximum TOTAL gas cost in ETH (hidden; e.g. 0.01): ");
        if (!/^(?:0|[1-9][0-9]{0,3})(?:\.[0-9]{1,18})?$/.test(budget)) fail("INPUT");
        const budgetWei = parseEther(budget);
        if (budgetWei <= 0n) fail("INPUT");
        manifest = publicManifest({
          version: 1,
          ...ARBITRUM,
          ...baseline,
          deployer: signer.address,
          budgetWei: budgetWei.toString(),
          builds: buildHashes(artifacts),
          transactions: {},
          contracts: {},
          verified: [],
        });
      } else if (signer.address !== manifest.deployer) fail("SIGNER");
      emit(`Chain: Arbitrum One (${ARBITRUM.chainId})`);
      emit(`Game: ${manifest.game}\nCST: ${manifest.cst}\nDeployer: ${manifest.deployer}`);
      emit(
        `First market cycle: ${manifest.firstMarketRound}; historical baseline evidence: ${manifest.evidenceHash}`,
      );
      emit(
        `Maximum total gas cost: ${formatEther(manifest.budgetWei)} ETH. No CST is transferred or approved by this command.`,
      );
      emit(
        "The constructor freezes the reviewed historical baseline. Public evidence is independently checkable; it is not an on-chain receipt-proof verifier.",
      );
      const confirmation = await prompt(
        "Type DEPLOY ARBITRUM to authorize the missing deployment transactions (hidden): ",
      );
      if (confirmation !== "DEPLOY ARBITRUM") fail("ABORTED");
      if (mode === "deploy") await saveManifest(manifestPath, manifest, { exclusive: true });
      await deployStack({
        manifest,
        provider,
        signer,
        artifacts,
        save: (value) => saveManifest(manifestPath, value),
        emit,
        signal: abort.signal,
      });
      signer = undefined;
    } else {
      // No Wallet is constructed, and no signing credential is requested here.
      for (const role of ["source", "market"])
        await confirmJournaled(role, manifest, provider, artifacts);
      await inspectContracts(manifest, provider);
      await saveManifest(manifestPath, manifest);
    }
    emit(
      `Market: ${manifest.contracts.market}\nSource: ${manifest.contracts.source}\nVault: ${manifest.contracts.vault}\nViews: ${manifest.contracts.views}`,
    );
    let apiKey = await prompt("Etherscan V2 API key for Arbiscan verification (hidden): ");
    if (!/^[A-Za-z0-9_-]{10,128}$/.test(apiKey)) fail("INPUT");
    const verify = await makeVerifier(rpcUrl, apiKey);
    apiKey = "";
    rpcUrl = "";
    await verifyStack({
      manifest,
      verify,
      save: (value) => saveManifest(manifestPath, value),
      emit,
      signal: abort.signal,
    });
    emit(
      "Deployment and verification complete. The public manifest contains the frontend contract addresses.",
    );
  } catch (error) {
    emit(safeError(error));
    process.exitCode = error instanceof DeploymentError && error.code === "ABORTED" ? 130 : 1;
  } finally {
    process.stdin.setRawMode?.(false);
    process.stdin.pause();
    provider?.destroy();
    if (lock) {
      await lock.close();
      await unlink(lockPath);
    }
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.off(signal, onSignal);
    // Do not restore dependency output: asynchronous failures may still contain
    // credentials. The CLI process exits once all pending operations complete.
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
