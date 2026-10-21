import { constants } from "node:fs";
import { open, readFile, rename } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import { dirname } from "node:path";
import {
  AbiCoder,
  Contract,
  ContractFactory,
  getAddress,
  getCreateAddress,
  keccak256,
} from "ethers";

export const ARBITRUM = Object.freeze({
  chainId: 42161,
  game: "0x6a714Ae7B5b6eA520F6BCA23d2E609C4Fd5863F2",
  cst: "0xAD91843e6A58Ba560F577E676986AFb1dba6FBA0",
});
// Reviewed proxy implementation, deliberately outside the serialized manifest.
export const V3_IMPLEMENTATION = "0xc1b97E1b0baC86248653B18706dbC5c8898c5c06";
export const IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
export const CONTRACTS = Object.freeze({
  source: "src/V3OutcomeSource.sol:V3OutcomeSource",
  market: "src/IndependentOutcomeMarket.sol:IndependentOutcomeMarket",
  vault: "src/OutcomeSettlementVault.sol:OutcomeSettlementVault",
  views: "src/IndependentOutcomeMarket.sol:IndependentMarketViews",
});
const MESSAGES = Object.freeze({
  ABORTED: "Cancelled. Existing public deployment receipts are retained.",
  TTY: "An interactive terminal is required. Piped credentials are not accepted.",
  INPUT: "Invalid input. No input value is printed or saved.",
  ARGUMENTS:
    "Use deploy, resume, or verify and an optional public manifest path. Credentials must be entered at the hidden prompts.",
  BUILD:
    "Production compilation failed. Run pnpm build:deployment without credentials to inspect compiler diagnostics.",
  CHAIN: "The endpoint is not the expected chain. No transaction was sent.",
  GAME: "The game, token, or configured first market cycle failed validation.",
  IMPLEMENTATION:
    "The game implementation does not match the reviewed Cosmic Signature V3 deployment.",
  MANIFEST: "The public manifest is invalid or does not match this build, chain, or signer.",
  EXISTS:
    "A deployment manifest already exists. Use resume or verify; fresh deployment is refused.",
  JOURNAL: "Could not save the public transaction journal. No further transaction will be sent.",
  PENDING:
    "A journaled transaction is pending or unavailable. Check its public hash before retrying resume. It will not be automatically resent.",
  REVERTED:
    "A journaled deployment transaction reverted. Resume will not replace it or deploy again.",
  BUDGET:
    "The deployment exceeds the confirmed total gas budget or the account balance is insufficient.",
  SIGNER: "The signing key is invalid or does not match the manifest deployer.",
  INCOMPLETE: "Deployment is incomplete. Use resume before verification.",
  VERIFY:
    "Explorer verification failed. The deployment remains recorded; run verify again with the same manifest. No redeployment is needed.",
  UNSAFE_RUNTIME:
    "Disable Node debugging, diagnostic reports, and injected startup scripts before entering credentials.",
  FAILED:
    "Deployment operation failed. Sensitive provider and signer diagnostics were suppressed. Check the public transaction journal before retrying.",
});
export class DeploymentError extends Error {
  constructor(code) {
    super(MESSAGES[code] ?? MESSAGES.FAILED);
    this.code = Object.hasOwn(MESSAGES, code) ? code : "FAILED";
  }
}
export function fail(code) {
  throw new DeploymentError(code);
}
export function safeError(error) {
  return error instanceof DeploymentError ? MESSAGES[error.code] : MESSAGES.FAILED;
}

/** Drop dependency logs rather than attempting to recognize every secret encoding.
 * Only the returned writer may emit our fixed messages and validated public data.
 * Keep the guard installed until process exit: late RPC failures must stay hidden.
 */
export function protectOutput(stdout = process.stdout, stderr = process.stderr) {
  const originalOut = stdout.write;
  const originalErr = stderr.write;
  const write = originalOut.bind(stdout);
  const discard = (_chunk, encoding, callback) => {
    const done = typeof encoding === "function" ? encoding : callback;
    if (typeof done === "function") queueMicrotask(done);
    return true;
  };
  stdout.write = discard;
  stderr.write = discard;
  return {
    write,
    restore() {
      stdout.write = originalOut;
      stderr.write = originalErr;
    },
  };
}

/** Raw mode disables terminal echo before any secret is read. Values never go
 * through readline history, environment variables, command arguments or files.
 */
export function hiddenPrompt(label, { input = process.stdin, write, signal } = {}) {
  if (!input.isTTY || typeof input.setRawMode !== "function") fail("TTY");
  if (!write) fail("TTY");
  return new Promise((resolve, reject) => {
    let value = "";
    const decoder = new StringDecoder("utf8");
    const previousRaw = input.isRaw;
    const cleanup = () => {
      input.off("data", onData);
      input.off("end", onEnd);
      input.off("error", onEnd);
      signal?.removeEventListener("abort", onEnd);
      input.setRawMode(Boolean(previousRaw));
      input.pause();
      write("\n");
    };
    const onEnd = () => {
      value = "";
      cleanup();
      reject(new DeploymentError("ABORTED"));
    };
    const onData = (chunk) => {
      for (const char of decoder.write(chunk)) {
        if (char === "\u0003" || char === "\u0004") return onEnd();
        if (char === "\r" || char === "\n") {
          const result = value;
          value = "";
          cleanup();
          resolve(result);
          return;
        }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else if (char >= " " && char !== "\u001b") value += char;
        else {
          value = "";
          cleanup();
          reject(new DeploymentError("INPUT"));
          return;
        }
        if (value.length > 4096) {
          value = "";
          cleanup();
          reject(new DeploymentError("INPUT"));
          return;
        }
      }
    };
    if (signal?.aborted) return reject(new DeploymentError("ABORTED"));
    input.setRawMode(true);
    input.on("data", onData);
    input.once("end", onEnd);
    input.once("error", onEnd);
    signal?.addEventListener("abort", onEnd, { once: true });
    write(label);
    input.resume();
  });
}

export function validateRuntime(
  execArgs = process.execArgv,
  options = process.env.NODE_OPTIONS ?? "",
  diagnosticEnvironment = process.env,
) {
  if (
    [...execArgs, options].some((value) =>
      /--(?:inspect|debug|report|require|import|experimental-loader|prof|cpu-prof|heap-prof|heapsnapshot|trace|diagnostic)|(?:^|\s)-r(?:\s|$)/.test(
        value,
      ),
    ) ||
    ["NODE_DEBUG", "NODE_DEBUG_NATIVE", "DEBUG", "NODE_V8_COVERAGE"].some(
      (key) => diagnosticEnvironment[key],
    )
  )
    fail("UNSAFE_RUNTIME");
}
export function validateRpc(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("INPUT");
  }
  if (url.protocol !== "https:" || url.hash || !url.hostname) fail("INPUT");
  return url.href;
}
export function positiveInteger(value) {
  if (!/^[1-9][0-9]{0,14}$/.test(value)) fail("INPUT");
  return value;
}
function address(value) {
  try {
    const result = getAddress(value);
    if (/^0x0{40}$/.test(result)) fail("MANIFEST");
    return result;
  } catch {
    fail("MANIFEST");
  }
}
function hash(value) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/i.test(value)) fail("MANIFEST");
  return value.toLowerCase();
}
function uint(value) {
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9][0-9]{0,77})$/.test(value) ||
    BigInt(value) >= 2n ** 256n
  )
    fail("MANIFEST");
  return value;
}
function exactKeys(object, keys) {
  if (
    !object ||
    typeof object !== "object" ||
    Array.isArray(object) ||
    Object.keys(object).some((key) => !keys.includes(key))
  )
    fail("MANIFEST");
}

/** Rebuild an allowlisted schema; never serialize a signer/provider/error object. */
export function publicManifest(value) {
  exactKeys(value, [
    "version",
    "chainId",
    "game",
    "cst",
    "firstMarketRound",
    "baseline",
    "evidenceHash",
    "deployer",
    "budgetWei",
    "builds",
    "transactions",
    "contracts",
    "verified",
  ]);
  if (value.version !== 1 || !Number.isSafeInteger(value.chainId) || value.chainId < 1)
    fail("MANIFEST");
  exactKeys(value.builds, Object.keys(CONTRACTS));
  exactKeys(value.transactions, ["source", "market"]);
  exactKeys(value.contracts, Object.keys(CONTRACTS));
  const builds = {},
    transactions = {},
    contracts = {};
  for (const role of Object.keys(CONTRACTS)) {
    builds[role] = hash(value.builds[role]);
    if (value.contracts[role]) contracts[role] = address(value.contracts[role]);
  }
  for (const role of ["source", "market"]) {
    const tx = value.transactions[role];
    if (!tx) continue;
    exactKeys(tx, ["hash", "address", "nonce", "maxCostWei"]);
    if (!Number.isSafeInteger(tx.nonce) || tx.nonce < 0) fail("MANIFEST");
    transactions[role] = {
      hash: hash(tx.hash),
      address: address(tx.address),
      nonce: tx.nonce,
      maxCostWei: uint(tx.maxCostWei),
    };
    if (
      address(getCreateAddress({ from: value.deployer, nonce: tx.nonce })) !==
      transactions[role].address
    )
      fail("MANIFEST");
  }
  const budgetWei = uint(value.budgetWei);
  const reserved = Object.values(transactions).reduce((sum, tx) => sum + BigInt(tx.maxCostWei), 0n);
  if (reserved > BigInt(budgetWei)) fail("MANIFEST");
  if (
    !Array.isArray(value.verified) ||
    value.verified.some((role) => !Object.hasOwn(CONTRACTS, role)) ||
    new Set(value.verified).size !== value.verified.length
  )
    fail("MANIFEST");
  return {
    version: 1,
    chainId: value.chainId,
    game: address(value.game),
    cst: address(value.cst),
    firstMarketRound: positiveInteger(value.firstMarketRound),
    deployer: address(value.deployer),
    baseline: baselineValues(value.baseline),
    evidenceHash: hash(value.evidenceHash),
    budgetWei,
    builds,
    transactions,
    contracts,
    verified: [...value.verified],
  };
}
const BASELINE_FIELDS = [
  "gestureCount",
  "ethSpent",
  "cstBurned",
  "highestCstPaid",
  "enduranceDuration",
  "chronoDuration",
];
export function baselineValues(value) {
  exactKeys(value, [...BASELINE_FIELDS, "sameGesture"]);
  if (typeof value.sameGesture !== "boolean") fail("MANIFEST");
  const result = Object.fromEntries(BASELINE_FIELDS.map((key) => [key, uint(value[key])]));
  if (
    ["gestureCount", "ethSpent", "enduranceDuration", "chronoDuration"].some(
      (key) => result[key] === "0",
    ) ||
    BigInt(result.highestCstPaid) > BigInt(result.cstBurned)
  )
    fail("MANIFEST");
  return { ...result, sameGesture: value.sameGesture };
}
export async function loadManifest(path) {
  try {
    return publicManifest(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    fail("MANIFEST");
  }
}
/** A synced file alone does not make its directory entry durable. Both initial
 * creation and atomic replacement must sync the containing directory before any
 * caller can broadcast the transaction whose hash was just journaled.
 */
async function syncParentDirectory(path) {
  const directory = await open(dirname(path), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
export async function saveManifest(path, value, { exclusive = false } = {}) {
  const data = JSON.stringify(publicManifest(value), null, 2) + "\n";
  if (exclusive) {
    let handle;
    try {
      handle = await open(path, "wx", 0o600);
      await handle.writeFile(data);
      await handle.sync();
      await syncParentDirectory(path);
    } catch (error) {
      if (error.code === "EEXIST") fail("EXISTS");
      fail("JOURNAL");
    } finally {
      await handle?.close();
    }
    return;
  }
  const temporary = `${path}.next`;
  let handle;
  try {
    handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
    await syncParentDirectory(path);
  } catch {
    fail("JOURNAL");
  } finally {
    await handle?.close();
  }
}

export function constructorArgs(role, manifest) {
  if (role === "source")
    return [
      manifest.game,
      BigInt(manifest.firstMarketRound),
      [
        ...BASELINE_FIELDS.map((key) => BigInt(manifest.baseline[key])),
        manifest.baseline.sameGesture,
      ],
    ];
  if (role === "market") return [manifest.cst, manifest.contracts.source];
  if (role === "vault") return [manifest.cst];
  return [];
}
export function buildHashes(artifacts) {
  return Object.fromEntries(
    Object.entries(artifacts).map(([role, artifact]) => [role, keccak256(artifact.bytecode)]),
  );
}
export async function assertChain(provider, expected) {
  if (BigInt(await provider.send("eth_chainId", [])) !== BigInt(expected.chainId)) fail("CHAIN");
}
/** Pin the reviewed production implementation at preflight and immediately
 * before signing a source deployment. Only the explicit local test chain skips
 * this public-chain check. This does not prevent future proxy upgrades.
 */
export async function assertProductionImplementation(provider, expected) {
  if (expected.chainId === 31337) return;
  if (expected.chainId !== ARBITRUM.chainId || address(expected.game) !== ARBITRUM.game)
    fail("IMPLEMENTATION");
  const word = await provider.send("eth_getStorageAt", [
    ARBITRUM.game,
    IMPLEMENTATION_SLOT,
    "latest",
  ]);
  if (
    typeof word !== "string" ||
    !/^0x0{24}[0-9a-f]{40}$/i.test(word) ||
    getAddress(`0x${word.slice(26)}`) !== V3_IMPLEMENTATION
  )
    fail("IMPLEMENTATION");
}
export async function validateGame(provider, expected, firstMarketRound, baseline) {
  await assertChain(provider, expected);
  await assertProductionImplementation(provider, expected);
  if (
    (await provider.getCode(expected.game)) === "0x" ||
    (await provider.getCode(expected.cst)) === "0x"
  )
    fail("GAME");
  const game = new Contract(
    expected.game,
    [
      "function token() view returns (address)",
      "function roundNum() view returns (uint256)",
      "function roundStats(uint256) view returns (uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)",
    ],
    provider,
  );
  if (address(await game.token()) !== address(expected.cst)) fail("GAME");
  const current = await game.roundNum();
  // Reading the full V3 return shape also rejects the old V2 implementation.
  await game.roundStats(current);
  // The frozen launch baseline remains valid after that cycle has closed.
  // Mirror the source constructor: future launch cycles are not supported.
  if (BigInt(firstMarketRound) > current || BigInt(firstMarketRound) < 1n) fail("GAME");
  const previous = await game.roundStats(BigInt(firstMarketRound) - 1n);
  if (previous[0] !== BigInt(baseline.gestureCount)) fail("GAME");
  return current;
}
export function validateManifestContext(manifest, expected, artifacts) {
  const clean = publicManifest(manifest);
  if (
    clean.chainId !== expected.chainId ||
    clean.game !== address(expected.game) ||
    clean.cst !== address(expected.cst)
  )
    fail("MANIFEST");
  const hashes = buildHashes(artifacts);
  if (Object.keys(CONTRACTS).some((role) => clean.builds[role] !== hashes[role])) fail("MANIFEST");
  return clean;
}

/** A missing receipt is ambiguous, never permission to send another transaction. */
export async function confirmJournaled(role, manifest, provider, artifacts) {
  const entry = manifest.transactions[role];
  if (!entry) fail("INCOMPLETE");
  const receipt = await provider.getTransactionReceipt(entry.hash);
  if (!receipt) fail("PENDING");
  if (receipt.status !== 1) fail("REVERTED");
  const tx = await provider.getTransaction(entry.hash);
  const factory = new ContractFactory(artifacts[role].abi, artifacts[role].bytecode);
  const expected = await factory.getDeployTransaction(...constructorArgs(role, manifest));
  if (
    !tx ||
    tx.to !== null ||
    address(tx.from) !== manifest.deployer ||
    tx.nonce !== entry.nonce ||
    tx.data !== expected.data ||
    address(receipt.contractAddress) !== entry.address ||
    (await provider.getCode(entry.address)) === "0x"
  )
    fail("MANIFEST");
  // The journal's reservation is derived from the signed transaction, not from
  // an editable receipt field or the lower effective fee eventually charged.
  const maxFee = tx.maxFeePerGas ?? tx.gasPrice;
  if (
    typeof tx.gasLimit !== "bigint" ||
    tx.gasLimit <= 0n ||
    typeof maxFee !== "bigint" ||
    maxFee < 0n ||
    BigInt(entry.maxCostWei) !== tx.gasLimit * maxFee
  )
    fail("MANIFEST");
  const reserved = Object.values(manifest.transactions).reduce(
    (sum, item) => sum + BigInt(item.maxCostWei),
    0n,
  );
  if (reserved > BigInt(manifest.budgetWei)) fail("MANIFEST");
  manifest.contracts[role] = entry.address;
}

/** Journal signed transaction hashes before broadcast; only public data is saved.
 * Resume never signs/rebroadcasts a journaled transaction, even if RPC says absent.
 */
export async function deployStack({
  manifest,
  provider,
  signer,
  artifacts,
  save,
  emit = () => {},
  signal,
}) {
  if (address(await signer.getAddress()) !== manifest.deployer) fail("SIGNER");
  for (const role of ["source", "market"]) {
    if (signal?.aborted) fail("ABORTED");
    await assertChain(provider, manifest);
    if (!manifest.transactions[role]) {
      const factory = new ContractFactory(artifacts[role].abi, artifacts[role].bytecode, signer);
      const unsigned = await factory.getDeployTransaction(...constructorArgs(role, manifest));
      unsigned.nonce = await provider.getTransactionCount(manifest.deployer, "pending");
      unsigned.chainId = manifest.chainId;
      const populated = await signer.populateTransaction(unsigned);
      populated.gasLimit = (populated.gasLimit * 120n) / 100n;
      const maxFee = populated.maxFeePerGas ?? populated.gasPrice;
      const maxCost = populated.gasLimit * maxFee;
      const reserved = Object.values(manifest.transactions).reduce(
        (sum, tx) => sum + BigInt(tx.maxCostWei),
        0n,
      );
      if (
        reserved + maxCost > BigInt(manifest.budgetWei) ||
        (await provider.getBalance(manifest.deployer)) < maxCost
      )
        fail("BUDGET");
      // Recheck after the interactive confirmation and RPC gas estimation.
      if (role === "source") await assertProductionImplementation(provider, manifest);
      let signed = await signer.signTransaction(populated);
      manifest.transactions[role] = {
        hash: keccak256(signed),
        address: getCreateAddress({ from: manifest.deployer, nonce: populated.nonce }),
        nonce: populated.nonce,
        maxCostWei: maxCost.toString(),
      };
      await save(manifest);
      emit(`${role} transaction: ${manifest.transactions[role].hash}`);
      if (signal?.aborted) fail("ABORTED");
      const response = await provider.broadcastTransaction(signed);
      signed = "";
      if (response.hash !== manifest.transactions[role].hash) fail("MANIFEST");
      await provider.waitForTransaction(response.hash, 1, 120_000);
    }
    await confirmJournaled(role, manifest, provider, artifacts);
    await save(manifest);
  }
  await inspectContracts(manifest, provider);
  await save(manifest);
  return manifest;
}

export async function inspectContracts(manifest, provider) {
  if (!manifest.contracts.source || !manifest.contracts.market) fail("INCOMPLETE");
  const source = new Contract(
    manifest.contracts.source,
    [
      "function game() view returns (address)",
      "function firstMarketRound() view returns (uint256)",
      "function baselineHash() view returns (bytes32)",
    ],
    provider,
  );
  const market = new Contract(
    manifest.contracts.market,
    [
      "function cst() view returns (address)",
      "function source() view returns (address)",
      "function settlementVault() view returns (address)",
      "function marketViews() view returns (address)",
    ],
    provider,
  );
  if (
    address(await source.game()) !== manifest.game ||
    (await source.firstMarketRound()).toString() !== manifest.firstMarketRound ||
    address(await market.cst()) !== manifest.cst ||
    address(await market.source()) !== manifest.contracts.source
  )
    fail("MANIFEST");
  const vault = address(await market.settlementVault());
  const expectedBaselineHash = keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "tuple(uint256,uint256,uint256,uint256,uint256,uint256,bool)"],
      [
        manifest.game,
        BigInt(manifest.firstMarketRound) - 1n,
        constructorArgs("source", manifest)[2],
      ],
    ),
  );
  if ((await source.baselineHash()) !== expectedBaselineHash) fail("MANIFEST");
  const views = address(await market.marketViews());
  if (
    vault !== getCreateAddress({ from: manifest.contracts.market, nonce: 1 }) ||
    views !== getCreateAddress({ from: manifest.contracts.market, nonce: 2 }) ||
    (await provider.getCode(views)) === "0x"
  )
    fail("MANIFEST");
  const vaultContract = new Contract(
    vault,
    ["function cst() view returns (address)", "function market() view returns (address)"],
    provider,
  );
  if (
    address(await vaultContract.cst()) !== manifest.cst ||
    address(await vaultContract.market()) !== manifest.contracts.market
  )
    fail("MANIFEST");
  manifest.contracts.vault = vault;
  manifest.contracts.views = views;
}

export async function verifyStack({ manifest, verify, save, emit = () => {}, signal }) {
  if (Object.keys(CONTRACTS).some((role) => !manifest.contracts[role])) fail("INCOMPLETE");
  for (const role of Object.keys(CONTRACTS)) {
    if (signal?.aborted) fail("ABORTED");
    // Always ask the explorer again. A local 'verified' flag is not evidence.
    let success = false;
    try {
      success = await verify({
        address: manifest.contracts[role],
        constructorArgs: constructorArgs(role, manifest),
        contract: CONTRACTS[role],
        provider: "etherscan",
      });
    } catch {
      fail("VERIFY");
    }
    if (success !== true) fail("VERIFY");
    if (!manifest.verified.includes(role)) manifest.verified.push(role);
    await save(manifest);
    emit(`Verified ${role}: https://arbiscan.io/address/${manifest.contracts[role]}#code`);
  }
}
