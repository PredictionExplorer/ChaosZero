import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  assertCleanPushTree,
  assertContractDependencies,
  assertPushReferencesMatchHead,
  assertStagedMatchesWorktree,
  classifyChanges,
  formatCandidates,
  run,
  verifyGeneratedFixture,
} from "./checks.mjs";

function temporaryDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), "chaos-zero-checks-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("contract prerequisites require both the test library and standard token implementation", (t) => {
  const root = temporaryDirectory(t);
  assert.throws(() => assertContractDependencies(root), /forge-std, OpenZeppelin ERC1155/);
  const forge = join(root, "lib/forge-std/src/Test.sol");
  mkdirSync(dirname(forge), { recursive: true });
  writeFileSync(forge, "// Test dependency fixture\n");
  assert.throws(() => assertContractDependencies(root), /missing \(OpenZeppelin ERC1155\)/);
  const erc1155 = join(root, "lib/openzeppelin-contracts/contracts/token/ERC1155/ERC1155.sol");
  mkdirSync(dirname(erc1155), { recursive: true });
  writeFileSync(erc1155, "// Token dependency fixture\n");
  assert.doesNotThrow(() => assertContractDependencies(root));
});

test("partially staged source cannot validate different code from the commit", (t) => {
  const root = temporaryDirectory(t);
  run("git", ["init", "--quiet", root]);
  const file = join(root, "source with spaces.ts");
  writeFileSync(file, "export const checked = true;\n");
  run("git", ["-C", root, "add", "source with spaces.ts"]);
  assert.doesNotThrow(() => assertStagedMatchesWorktree(root, ["source with spaces.ts"]));
  writeFileSync(file, "export const checked = false;\n");
  assert.throws(
    () => assertStagedMatchesWorktree(root, ["source with spaces.ts"]),
    /unstaged changes/,
  );
});

test("failed fixture generation preserves the checked-in fixture", (t) => {
  const file = join(temporaryDirectory(t), "vectors.json");
  writeFileSync(file, "original\n");
  assert.throws(
    () =>
      verifyGeneratedFixture(file, () => {
        writeFileSync(file, "partial output\n");
        throw new Error("generator failed");
      }),
    /generator failed/,
  );
  assert.equal(readFileSync(file, "utf8"), "original\n");
});

test("fixture drift fails without rewriting the checked-in expected result", (t) => {
  const file = join(temporaryDirectory(t), "vectors.json");
  writeFileSync(file, "original\n");
  assert.throws(
    () => verifyGeneratedFixture(file, () => writeFileSync(file, "different\n")),
    /fixtures differ/,
  );
  assert.equal(readFileSync(file, "utf8"), "original\n");
  assert.doesNotThrow(() => verifyGeneratedFixture(file, () => writeFileSync(file, "original\n")));
});

test("shared tooling changes require both application and contract checks", () => {
  assert.deepEqual(classifyChanges(["scripts/check.mjs"]), {
    contracts: true,
    frontend: true,
    tooling: true,
  });
  assert.equal(classifyChanges(["src/Market.sol"]).contracts, true);
  assert.equal(classifyChanges(["test/Market.t.sol"]).contracts, true);
  assert.deepEqual(classifyChanges(["foundry.lock"]), {
    contracts: true,
    frontend: false,
    tooling: false,
  });
  assert.equal(classifyChanges(["frontend/src/lib/math.ts"]).frontend, true);
  assert.deepEqual(classifyChanges(["README.md"]), {
    contracts: false,
    frontend: false,
    tooling: false,
  });
});

test("generated and vendored data are excluded from source formatting", () => {
  assert.deepEqual(
    formatCandidates([
      "frontend/src/lib/math.ts",
      "frontend/src/test/fixtures/contract-vectors.json",
      "frontend/src/lib/abi/market.json",
      "frontend/pnpm-lock.yaml",
      "lib/forge-std/package.json",
      "broadcast/Deploy.s.sol/42161/run-latest.json",
      ".github/workflows/test.yml",
    ]),
    ["frontend/src/lib/math.ts", ".github/workflows/test.yml"],
  );
});

test("a missing tool or failed command stops the gate", () => {
  assert.throws(() => run("chaos-zero-tool-that-does-not-exist", []), /Cannot run/);
  assert.throws(() => run(process.execPath, ["-e", "process.exit(7)"]), /failed \(7\)/);
});

test("unstaged supporting sources cannot hide a broken staged application", (t) => {
  const root = temporaryDirectory(t);
  run("git", ["init", "--quiet", root]);
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src/Market.sol"), "staged contract\n");
  run("git", ["-C", root, "add", "src/Market.sol"]);
  writeFileSync(join(root, "src/UncommittedDependency.sol"), "unstaged support\n");
  assert.throws(
    () => assertStagedMatchesWorktree(root, ["src/Market.sol"]),
    /UncommittedDependency/,
  );
});

test("push checks cannot validate a different branch or dirty working tree", (t) => {
  const head = "a".repeat(40);
  const other = "b".repeat(40);
  const zero = "0".repeat(40);
  const resolve = (hash) => hash;
  assert.doesNotThrow(() =>
    assertPushReferencesMatchHead(`refs/heads/main ${head} refs/heads/main ${zero}`, head, resolve),
  );
  assert.doesNotThrow(() =>
    assertPushReferencesMatchHead(`(delete) ${zero} refs/heads/old ${other}`, head, resolve),
  );
  assert.throws(
    () =>
      assertPushReferencesMatchHead(
        `refs/heads/other ${other} refs/heads/other ${zero}`,
        head,
        resolve,
      ),
    /checked-out commit/,
  );
  const root = temporaryDirectory(t);
  run("git", ["init", "--quiet", root]);
  assert.doesNotThrow(() => assertCleanPushTree(root));
  writeFileSync(join(root, "uncommitted.txt"), "uncommitted\n");
  assert.throws(() => assertCleanPushTree(root), /clean working tree/);
});
