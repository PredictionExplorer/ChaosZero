import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { localPort, localRpc } from "./local-runtime.mjs";

const execute = promisify(execFile);
const launcher = path.join(path.dirname(fileURLToPath(import.meta.url)), "local-dev.mjs");

test("local ports accept valid boundaries and reject malformed or privileged endpoints", () => {
  assert.equal(localPort(undefined, 3000, "PORT"), 3000);
  for (const n of [1024, 3100, 65535]) assert.equal(localPort(String(n), 3000, "PORT"), n);
  for (const value of ["", "abc", "1.5", "0", "80", "65536", "Infinity", "-1"]) {
    assert.throws(() => localPort(value, 3000, "PORT"), /must be an integer/);
  }
});

test("smoke transactions require loopback HTTP and the exact development chain", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    assert.equal(localRpc({ chainId: 31337, rpcUrl: `http://${host}:8555` }).hostname, host);
  }
  for (const rpcUrl of [
    "https://arb1.arbitrum.io/rpc",
    "http://example.com:8555",
    "https://localhost:8555",
    "http://localhost.evil.test",
    "http://user:password@localhost:8555",
  ]) {
    assert.throws(() => localRpc({ chainId: 31337, rpcUrl }), /restricted/);
  }
  assert.throws(() => localRpc({ chainId: 42161, rpcUrl: "http://127.0.0.1:8555" }), /restricted/);
});

test("launcher fails before starting services for conflicting ports", async () => {
  await assert.rejects(
    execute(process.execPath, [launcher], {
      cwd: process.env.TMPDIR ?? "/tmp",
      env: { ...process.env, PORT: "3100", ANVIL_PORT: "3100" },
      timeout: 5000,
    }),
    (error) => error.code === 1 && /PORT and ANVIL_PORT must differ/.test(error.stderr),
  );
});

test("launcher refuses an occupied endpoint without disrupting its owner", async () => {
  const occupied = createServer();
  occupied.listen(0, "127.0.0.1");
  await once(occupied, "listening");
  const address = occupied.address();
  assert.ok(address && typeof address !== "string");
  try {
    await assert.rejects(
      execute(process.execPath, [launcher], {
        env: {
          ...process.env,
          PORT: String(address.port),
          ANVIL_PORT: String(address.port === 65534 ? 65533 : 65534),
        },
        timeout: 5000,
      }),
      (error) => error.code === 1 && /EADDRINUSE/.test(error.stderr),
    );
    assert.equal(occupied.listening, true);
  } finally {
    await new Promise((resolve) => occupied.close(resolve));
  }
});
