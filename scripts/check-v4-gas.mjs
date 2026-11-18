import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const suite = "GameFundedGasBenchmarksTest";
const baseline = join(root, "snapshots", `${suite}.json`);

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--update")) {
    throw new Error("Usage: node scripts/check-v4-gas.mjs [--update]");
  }
  const output = await mkdtemp(join(tmpdir(), "chaos-zero-v4-gas-"));
  try {
    // A fresh snapshot directory makes removed or renamed benchmarks visible.
    execFileSync(
      "forge",
      ["test", "--isolate", "--match-contract", `^${suite}$`, "--gas-snapshot-emit", "true"],
      {
        cwd: root,
        stdio: "inherit",
        env: {
          ...process.env,
          FOUNDRY_PROFILE: "default",
          FOUNDRY_TEST: "benchmarks",
          FOUNDRY_SNAPSHOTS: output,
        },
      },
    );
    const measured = JSON.parse(await readFile(join(output, `${suite}.json`), "utf8"));
    if (args[0] === "--update") {
      await writeFile(baseline, JSON.stringify(measured, null, 2) + "\n");
      console.log(`Updated ${suite} baseline. Review the gas changes before committing.`);
    } else {
      assert.deepEqual(measured, JSON.parse(await readFile(baseline, "utf8")));
      console.log(`Verified ${Object.keys(measured).length} V4 market call-frame gas snapshots.`);
    }
  } finally {
    await rm(output, { recursive: true, force: true });
  }
}

await main();
