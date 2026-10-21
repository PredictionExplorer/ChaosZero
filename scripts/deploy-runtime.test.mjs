import assert from "node:assert/strict";
import { mkdtemp, open, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { PassThrough } from "node:stream";
import test from "node:test";
import { ContractFactory, getCreateAddress } from "ethers";
import {
  ARBITRUM,
  IMPLEMENTATION_SLOT,
  V3_IMPLEMENTATION,
  CONTRACTS,
  DeploymentError,
  assertChain,
  assertProductionImplementation,
  deployStack,
  validateGame,
  baselineValues,
  confirmJournaled,
  constructorArgs,
  hiddenPrompt,
  loadManifest,
  protectOutput,
  publicManifest,
  safeError,
  saveManifest,
  validateRpc,
  validateRuntime,
  verifyStack,
} from "./deploy-runtime.mjs";
import {
  REVIEWED_BASELINE_HASH,
  parseArguments,
  validateBaselineEvidence,
} from "./deploy-arbitrum.mjs";

const secret = "never-print-a-private-key-or-rpc-api-token";
const hash = `0x${"11".repeat(32)}`;
const deployer = "0x1111111111111111111111111111111111111111";
test("production launcher accepts only the reviewed round-two constructor baseline", () => {
  const evidence = {
    ...ARBITRUM,
    baselineRound: "2",
    firstMarketRound: "3",
    constructorBaselineHash: REVIEWED_BASELINE_HASH,
    values: {
      gestureCount: "1257",
      ethSpent: "17785933723725359657",
      cstBurned: "118887756299069655832122",
      highestCstPaid: "469235819458920479966",
      enduranceDuration: "17766",
      chronoDuration: "783402",
      sameGesture: false,
    },
  };
  assert.equal(validateBaselineEvidence(JSON.stringify(evidence)).baseline.gestureCount, "1257");
  assert.throws(
    () =>
      validateBaselineEvidence(
        JSON.stringify({ ...evidence, values: { ...evidence.values, chronoDuration: "783403" } }),
      ),
    { code: "MANIFEST" },
  );
  assert.throws(
    () => validateBaselineEvidence(JSON.stringify({ ...evidence, constructorBaselineHash: hash })),
    { code: "MANIFEST" },
  );
});
export function fixture() {
  return {
    version: 1,
    ...ARBITRUM,
    firstMarketRound: "3",
    deployer,
    budgetWei: "10000000000000000",
    baseline: {
      gestureCount: "1257",
      ethSpent: "50",
      cstBurned: "20",
      highestCstPaid: "10",
      enduranceDuration: "8",
      chronoDuration: "9",
      sameGesture: false,
    },
    evidenceHash: hash,
    builds: Object.fromEntries(Object.keys(CONTRACTS).map((role) => [role, hash])),
    transactions: {},
    contracts: {},
    verified: [],
  };
}

test("only typed public receipt fields can reach the manifest", () => {
  assert.deepEqual(publicManifest(fixture()), fixture());
  for (const value of [
    { ...fixture(), privateKey: secret },
    { ...fixture(), rpcUrl: `https://rpc.test/${secret}` },
    { ...fixture(), error: new Error(secret) },
    { ...fixture(), contracts: { source: secret } },
    { ...fixture(), builds: { ...fixture().builds, key: secret } },
    {
      ...fixture(),
      transactions: {
        source: {
          hash,
          address: getCreateAddress({ from: deployer, nonce: 1 }),
          nonce: 1,
          maxCostWei: "10",
          signer: secret,
        },
      },
    },
    {
      ...fixture(),
      transactions: { source: { hash, address: deployer, nonce: 1, maxCostWei: "10" } },
    },
    { ...fixture(), verified: [secret] },
  ])
    assert.throws(() => publicManifest(value), DeploymentError);
  assert.throws(() => baselineValues({ ...fixture().baseline, ethSpent: "0" }), DeploymentError);
});

test("journal is exclusive, atomic, public-only, and reloadable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chaos-deploy-test-"));
  const file = join(directory, "receipt.json");
  try {
    await saveManifest(file, fixture(), { exclusive: true });
    await assert.rejects(saveManifest(file, fixture(), { exclusive: true }), { code: "EXISTS" });
    const manifest = fixture();
    manifest.transactions.source = {
      hash,
      address: getCreateAddress({ from: deployer, nonce: 1 }),
      nonce: 1,
      maxCostWei: "10",
    };
    await saveManifest(file, manifest);
    assert.deepEqual(await loadManifest(file), manifest);
    assert.equal((await readFile(file, "utf8")).includes(secret), false);
    assert.deepEqual(await readdir(directory), ["receipt.json"]);
    assert.equal(await loadManifest(join(directory, "missing.json")), undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("dependency output and hostile errors cannot reveal credentials", async () => {
  let captured = "";
  const out = {
    write(text) {
      captured += text;
      return true;
    },
  };
  const err = {
    write(text) {
      captured += text;
      return true;
    },
  };
  const guarded = protectOutput(out, err);
  let callbackCalled = false;
  out.write(secret, () => {
    callbackCalled = true;
  });
  err.write(JSON.stringify({ request: { url: `https://rpc.test/${secret}` }, privateKey: secret }));
  const malicious = {
    get message() {
      throw new Error(secret);
    },
    toString() {
      throw new Error(secret);
    },
  };
  guarded.write(safeError(malicious));
  guarded.write(safeError(new Error(secret)));
  guarded.write(safeError(new DeploymentError(secret)));
  await new Promise(queueMicrotask);
  assert.equal(callbackCalled, true);
  assert.equal(captured.includes(secret), false);
  assert.match(captured, /diagnostics were suppressed/);
  guarded.restore();
});

test("credentials cannot be supplied through CLI options, insecure RPC or debug runtime", () => {
  for (const args of [
    [],
    ["deploy", "--private-key", secret],
    ["verify", "--api-key"],
    ["anything"],
    ["deploy", "secret.txt"],
  ])
    assert.throws(() => parseArguments(args), DeploymentError);
  assert.equal(parseArguments(["verify", "receipt.json"]).mode, "verify");
  for (const rpc of ["http://rpc.test", "file:///secret", "not a URL", "https://rpc.test/#token"])
    assert.throws(() => validateRpc(rpc), DeploymentError);
  assert.equal(validateRpc("https://rpc.test/v2/api-key"), "https://rpc.test/v2/api-key");
  for (const flag of [
    "--inspect",
    "--report-on-fatalerror",
    "--require injected.cjs",
    "--import ./injected.mjs",
    "-r injected",
    "--heap-prof",
    "--trace-events-enabled",
  ])
    assert.throws(() => validateRuntime([], flag, {}), DeploymentError);
  assert.throws(() => validateRuntime([], "", { NODE_DEBUG: "http" }), DeploymentError);
});

function terminal() {
  const input = new PassThrough();
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = (raw) => {
    input.isRaw = raw;
  };
  return input;
}
test("hidden prompt disables echo, supports correction and restores raw mode", async () => {
  const input = terminal();
  let output = "";
  const answer = hiddenPrompt("Hidden: ", {
    input,
    write: (text) => {
      output += text;
    },
  });
  assert.equal(input.isRaw, true);
  input.write(Buffer.from("secrex\x7ft\r"));
  assert.equal(await answer, "secret");
  assert.equal(input.isRaw, false);
  assert.equal(output, "Hidden: \n");
  assert.equal(input.listenerCount("data"), 0);
});
test("hidden prompt cancels on Ctrl-C, EOF and abort; never accepts pipes", async () => {
  assert.throws(() => hiddenPrompt("key", { input: new PassThrough(), write() {} }), {
    code: "TTY",
  });
  for (const action of ["interrupt", "eof", "abort"]) {
    const input = terminal();
    const abort = new AbortController();
    const answer = hiddenPrompt("Hidden: ", { input, write() {}, signal: abort.signal });
    if (action === "interrupt") input.write(Buffer.from(`${secret}\x03`));
    if (action === "eof") input.end();
    if (action === "abort") abort.abort();
    await assert.rejects(answer, { code: "ABORTED" });
    assert.equal(input.isRaw, false);
  }
});

test("real PTY never echoes the secret and restores terminal state", () => {
  const program = `import {hiddenPrompt} from './scripts/deploy-runtime.mjs'; const value=await hiddenPrompt('Hidden: ',{write:process.stdout.write.bind(process.stdout)}); if(value!=='${secret}') process.exit(2); console.log(process.stdin.isRaw?'RAW':'RESTORED');`;
  const python = `import os,pty,select,time,sys\npid,fd=pty.fork()\nif pid==0: os.execv(sys.argv[1],[sys.argv[1],'--input-type=module','-e',sys.argv[2]])\noutput=b''\nsent=False\ndeadline=time.monotonic()+10\nwhile time.monotonic()<deadline:\n ready,_,_=select.select([fd],[],[],0.1)\n if ready:\n  try: data=os.read(fd,8192)\n  except OSError: break\n  if not data: break\n  output+=data\n  if b'Hidden: ' in output and not sent:\n   os.write(fd,sys.argv[3].encode()+b'\\r'); sent=True\nelse:\n os.kill(pid,9); raise RuntimeError('timeout')\n_,status=os.waitpid(pid,0)\nsys.stdout.buffer.write(output)\nsys.exit(os.waitstatus_to_exitcode(status))`;
  const result = spawnSync("python3", ["-c", python, process.execPath, program, secret], {
    cwd: resolve(import.meta.dirname, ".."),
    encoding: "utf8",
    timeout: 15_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.includes(secret), false);
  assert.match(result.stdout, /RESTORED/);
});

test("wrong chain and ambiguous journal never permit a redeployment", async () => {
  await assert.rejects(assertChain({ send: async () => "0x1" }, ARBITRUM), { code: "CHAIN" });
  const manifest = fixture();
  manifest.transactions.source = {
    hash,
    address: getCreateAddress({ from: deployer, nonce: 1 }),
    nonce: 1,
    maxCostWei: "10",
  };
  await assert.rejects(
    confirmJournaled("source", manifest, { getTransactionReceipt: async () => null }, {}),
    { code: "PENDING" },
  );
  await assert.rejects(
    confirmJournaled(
      "source",
      manifest,
      { getTransactionReceipt: async () => ({ status: 0 }) },
      {},
    ),
    { code: "REVERTED" },
  );
});

test("verification retries all four contracts and never deploys or persists raw errors", async () => {
  const manifest = fixture();
  for (const [index, role] of Object.keys(CONTRACTS).entries())
    manifest.contracts[role] = getCreateAddress({ from: deployer, nonce: index });
  const saved = [],
    calls = [];
  const save = async (value) => {
    saved.push(publicManifest(value));
  };
  await assert.rejects(
    verifyStack({
      manifest,
      save,
      verify: async (parameters) => {
        calls.push(parameters);
        if (calls.length === 2) throw new Error(secret);
        return true;
      },
    }),
    { code: "VERIFY" },
  );
  assert.deepEqual(manifest.verified, ["source"]);
  calls.length = 0;
  await verifyStack({
    manifest,
    save,
    verify: async (parameters) => {
      calls.push(parameters);
      return true;
    },
  });
  assert.equal(calls.length, 4);
  assert.deepEqual(manifest.verified, Object.keys(CONTRACTS));
  assert.equal(JSON.stringify(saved).includes(secret), false);
  assert.equal(calls[0].provider, "etherscan");
  assert.equal(calls[0].constructorArgs.length, 3);
});

test("journal creation and replacement wait for the parent directory to be durable", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "chaos-journal-durability-"));
  const file = join(directory, "receipt.json");
  const probe = await open(directory, "r");
  const prototype = Object.getPrototypeOf(probe);
  const originalSync = prototype.sync;
  await probe.close();
  const operations = [];
  let release;
  let reachedDirectory;
  let directoryReached = new Promise((resolve) => {
    reachedDirectory = resolve;
  });
  let holdDirectory = new Promise((resolve) => {
    release = resolve;
  });
  const mock = t.mock.method(prototype, "sync", async function () {
    const isDirectory = (await this.stat()).isDirectory();
    operations.push(isDirectory ? "directory" : "file");
    if (isDirectory) {
      // At replacement time the final path must already name the new data.
      assert.equal(JSON.parse(await readFile(file, "utf8")).budgetWei, expectedBudget);
      reachedDirectory();
      await holdDirectory;
    }
    return originalSync.call(this);
  });
  let expectedBudget = fixture().budgetWei;
  try {
    let completed = false;
    const creation = saveManifest(file, fixture(), { exclusive: true }).then(() => {
      completed = true;
    });
    await directoryReached;
    assert.deepEqual(operations, ["file", "directory"]);
    assert.equal(completed, false, "save must not release the broadcaster before directory fsync");
    release();
    await creation;
    operations.length = 0;
    directoryReached = new Promise((resolve) => {
      reachedDirectory = resolve;
    });
    holdDirectory = new Promise((resolve) => {
      release = resolve;
    });
    expectedBudget = "20000000000000000";
    completed = false;
    const replacement = saveManifest(file, { ...fixture(), budgetWei: expectedBudget }).then(() => {
      completed = true;
    });
    await directoryReached;
    assert.deepEqual(operations, ["file", "directory"]);
    assert.equal(completed, false);
    assert.equal((await readdir(directory)).includes("receipt.json.next"), false);
    release();
    await replacement;
  } finally {
    release();
    mock.mock.restore();
    await rm(directory, { recursive: true, force: true });
  }
});

test("directory sync failures fail closed for both initial creation and replacement", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "chaos-journal-sync-failure-"));
  const file = join(directory, "receipt.json");
  const probe = await open(directory, "r");
  const prototype = Object.getPrototypeOf(probe);
  const originalSync = prototype.sync;
  await probe.close();
  const mock = t.mock.method(prototype, "sync", async function () {
    if ((await this.stat()).isDirectory()) throw new Error(secret);
    return originalSync.call(this);
  });
  try {
    await assert.rejects(saveManifest(file, fixture(), { exclusive: true }), { code: "JOURNAL" });
    await assert.rejects(saveManifest(file, fixture()), { code: "JOURNAL" });
  } finally {
    mock.mock.restore();
    await rm(directory, { recursive: true, force: true });
  }
});

test("resume authenticates the gas reservation against the signed transaction", async () => {
  const artifacts = {
    source: {
      abi: [
        "constructor(address game,uint256 firstMarketRound,tuple(uint256,uint256,uint256,uint256,uint256,uint256,bool) baseline)",
      ],
      bytecode: "0x6000",
    },
  };
  const manifest = fixture();
  const contractAddress = getCreateAddress({ from: deployer, nonce: 1 });
  manifest.transactions.source = { hash, address: contractAddress, nonce: 1, maxCostWei: "200000" };
  const transaction = {
    to: null,
    from: deployer,
    nonce: 1,
    ...(await new ContractFactory(
      artifacts.source.abi,
      artifacts.source.bytecode,
    ).getDeployTransaction(...constructorArgs("source", manifest))),
    gasLimit: 1000n,
    maxFeePerGas: 200n,
    gasPrice: 90n,
  };
  const provider = {
    getTransactionReceipt: async () => ({ status: 1, contractAddress }),
    getTransaction: async () => transaction,
    getCode: async () => "0x6000",
  };
  await confirmJournaled("source", structuredClone(manifest), provider, artifacts);
  for (const maxCostWei of ["0", "90000", "200001"]) {
    const altered = structuredClone(manifest);
    altered.transactions.source.maxCostWei = maxCostWei;
    await assert.rejects(confirmJournaled("source", altered, provider, artifacts), {
      code: "MANIFEST",
    });
  }
  // Legacy transactions have no EIP-1559 cap: the signed gasPrice is the maximum.
  transaction.maxFeePerGas = null;
  const legacy = structuredClone(manifest);
  legacy.transactions.source.maxCostWei = "90000";
  await confirmJournaled("source", legacy, provider, artifacts);
  transaction.gasPrice = null;
  await assert.rejects(confirmJournaled("source", legacy, provider, artifacts), {
    code: "MANIFEST",
  });
});

test("the sum of both journaled reservations cannot exceed the confirmed total budget", () => {
  const manifest = fixture();
  manifest.budgetWei = "100";
  manifest.transactions = {
    source: {
      hash,
      address: getCreateAddress({ from: deployer, nonce: 1 }),
      nonce: 1,
      maxCostWei: "60",
    },
    market: {
      hash,
      address: getCreateAddress({ from: deployer, nonce: 2 }),
      nonce: 2,
      maxCostWei: "41",
    },
  };
  assert.throws(() => publicManifest(manifest), { code: "MANIFEST" });
  manifest.transactions.market.maxCostWei = "40";
  assert.equal(publicManifest(manifest).budgetWei, "100");
});

test("production preflight reads the actual EIP-1967 slot and rejects an implementation change", async () => {
  const correct = `0x${"0".repeat(24)}${V3_IMPLEMENTATION.slice(2).toLowerCase()}`;
  const reads = [];
  let word = correct;
  const provider = {
    send: async (method, args) => {
      reads.push({ method, args });
      if (method === "eth_chainId") return "0xa4b1";
      return word;
    },
  };
  await assertProductionImplementation(provider, ARBITRUM);
  assert.deepEqual(reads, [
    { method: "eth_getStorageAt", args: [ARBITRUM.game, IMPLEMENTATION_SLOT, "latest"] },
  ]);
  for (const unexpected of [
    `0x${"0".repeat(64)}`,
    `0x${"0".repeat(24)}${deployer.slice(2)}`,
    "0x1234",
  ]) {
    word = unexpected;
    await assert.rejects(validateGame(provider, ARBITRUM, "3", fixture().baseline), {
      code: "IMPLEMENTATION",
    });
  }
  await assert.rejects(assertProductionImplementation(provider, { ...ARBITRUM, game: deployer }), {
    code: "IMPLEMENTATION",
  });
  await assert.rejects(assertProductionImplementation(provider, { ...ARBITRUM, chainId: 1 }), {
    code: "IMPLEMENTATION",
  });
  let localRead = false;
  await assertProductionImplementation(
    {
      send: async () => {
        localRead = true;
      },
    },
    { chainId: 31337, game: deployer },
  );
  assert.equal(localRead, false);
});

test("an upgrade after initial preflight stops source signing and broadcast", async () => {
  let currentImplementation = `0x${"0".repeat(24)}${V3_IMPLEMENTATION.slice(2).toLowerCase()}`;
  const provider = {
    send: async (method) => (method === "eth_chainId" ? "0xa4b1" : currentImplementation),
    getTransactionCount: async () => 1,
    getBalance: async () => 10n ** 18n,
    broadcastTransaction: async () => assert.fail("changed implementation must never broadcast"),
  };
  await assertProductionImplementation(provider, ARBITRUM);
  const signer = {
    getAddress: async () => deployer,
    populateTransaction: async (unsigned) => {
      // Simulate an upgrade while the operator confirmed and gas was estimated.
      currentImplementation = `0x${"0".repeat(24)}${deployer.slice(2)}`;
      return { ...unsigned, gasLimit: 1000n, maxFeePerGas: 200n };
    },
    signTransaction: async () => assert.fail("changed implementation must never sign"),
  };
  const artifacts = {
    source: {
      abi: [
        "constructor(address,uint256,tuple(uint256,uint256,uint256,uint256,uint256,uint256,bool))",
      ],
      bytecode: "0x6000",
    },
  };
  await assert.rejects(
    deployStack({
      manifest: fixture(),
      provider,
      signer,
      artifacts,
      save: async () => assert.fail("changed implementation must not create an ambiguous journal"),
    }),
    { code: "IMPLEMENTATION" },
  );
});
