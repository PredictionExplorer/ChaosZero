import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { localPort } from "./local-runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const children = new Set();
let closing = false;

function start(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    // Keep children in the launcher's process group. Terminal interruption must
    // also reach them if the package-manager parent is terminated abruptly.
    detached: false,
    ...options,
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

async function run(command, args, options) {
  const child = start(command, args, options);
  const [code, signal] = await once(child, "exit");
  if (code !== 0) throw new Error(`${command} failed (${signal ?? code}).`);
}

async function assertUnused(value) {
  const server = createServer();
  server.listen(value, "127.0.0.1");
  await once(server, "listening");
  await new Promise((resolve) => server.close(resolve));
}

async function rpc(url, method, params = []) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(2000),
  });
  if (!response.ok) throw new Error(`Local RPC returned ${response.status}.`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message);
  return payload.result;
}

async function stop(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") console.error(error.message);
    }
  }
  await delay(300);
  for (const child of children) {
    try {
      child.kill("SIGKILL");
    } catch {}
  }
  process.exit(code);
}

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());

try {
  const webPort = localPort(process.env.PORT, 3000, "PORT");
  const anvilPort = localPort(process.env.ANVIL_PORT, 8545, "ANVIL_PORT");
  if (webPort === anvilPort) throw new Error("PORT and ANVIL_PORT must differ.");
  await Promise.all([assertUnused(webPort), assertUnused(anvilPort)]);
  const rpcUrl = `http://127.0.0.1:${anvilPort}`;
  const anvil = start(
    "anvil",
    [
      "--host",
      "127.0.0.1",
      "--port",
      String(anvilPort),
      "--chain-id",
      "31337",
      "--gas-limit",
      "32000000",
      "--silent",
    ],
    { env: { ...process.env, RUST_LOG: "error" } },
  );
  anvil.once("error", (error) => {
    console.error(error.message);
    void stop(1);
  });
  anvil.once("exit", () => {
    if (!closing) {
      console.error("Local chain stopped unexpectedly.");
      void stop(1);
    }
  });
  let connected = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      if ((await rpc(rpcUrl, "eth_chainId")) !== "0x7a69")
        throw new Error("Refusing a non-local chain.");
      connected = true;
      break;
    } catch {
      await delay(100);
    }
  }
  if (!connected) throw new Error("Local Anvil did not become ready.");
  // Known PUBLIC Anvil account; eth_sendTransaction uses only this disposable unlocked chain.
  await run("forge", [
    "script",
    "script/DeploySharedLocal.s.sol:DeploySharedLocal",
    "--rpc-url",
    rpcUrl,
    "--sender",
    "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    "--unlocked",
    "--broadcast",
    "--slow",
    "--non-interactive",
  ]);
  const broadcast = JSON.parse(
    await readFile(
      path.join(root, "broadcast/DeploySharedLocal.s.sol/31337/run-latest.json"),
      "utf8",
    ),
  );
  const deployed = (name) => {
    const address = broadcast.transactions.find(
      (tx) => tx.transactionType === "CREATE" && tx.contractName === name,
    )?.contractAddress;
    if (!/^0x[\da-fA-F]{40}$/.test(address ?? "")) throw new Error(`No ${name} deployment found.`);
    return address;
  };
  const marketAddress = deployed("SharedOutcomeMarket");
  if ((await rpc(rpcUrl, "eth_getCode", [marketAddress, "latest"])) === "0x")
    throw new Error("Market deployment has no bytecode.");
  const firstBlock = BigInt(broadcast.receipts[0].blockNumber).toString();
  const deployment = {
    chainId: 31337,
    rpcUrl,
    marketAddress,
    sourceAddress: deployed("LocalOutcomeSource"),
    gameAddress: deployed("LocalCosmicGame"),
    deployBlock: firstBlock,
    webUrl: `http://127.0.0.1:${webPort}/shared`,
  };
  await mkdir(path.join(root, ".local"), { recursive: true });
  await writeFile(
    path.join(root, ".local/shared-deployment.json"),
    `${JSON.stringify(deployment, null, 2)}\n`,
  );
  console.log(
    `\nLocal eight-market prototype: ${deployment.webUrl}\nAll tokens and ETH here are disposable development funds.\n`,
  );
  const web = start(
    process.execPath,
    [
      path.join(root, "frontend/node_modules/next/dist/bin/next"),
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(webPort),
    ],
    {
      cwd: path.join(root, "frontend"),
      env: {
        ...process.env,
        NEXT_PUBLIC_CHAIN_ID: "31337",
        NEXT_PUBLIC_RPC_URL: rpcUrl,
        NEXT_PUBLIC_MARKET_ADDRESS: "",
        NEXT_PUBLIC_SHARED_MARKET_ADDRESS: marketAddress,
        NEXT_PUBLIC_SHARED_DEPLOY_BLOCK: firstBlock,
        NEXT_PUBLIC_LOCAL_SIMULATOR: "1",
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  );
  web.once("error", (error) => {
    console.error(error.message);
    void stop(1);
  });
  const [code] = await once(web, "exit");
  await stop(code ?? 1);
} catch (error) {
  console.error(`Local setup failed: ${error.message}`);
  await stop(1);
}
