import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertCleanPushTree,
  assertPushReferencesMatchHead,
  assertStagedMatchesWorktree,
  classifyChanges,
  formatCandidates,
  git,
  gitFiles,
  run,
  verifyGeneratedFixture,
} from "./checks.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const frontend = join(root, "frontend");
const mode = process.argv[2] ?? "pre-push";
const execute = (command, args, options = {}) => run(command, args, { cwd: root, ...options });
const pnpm = (args, options) => execute("pnpm", args, options);
const forge = (args, options) => execute("forge", args, options);
const step = (name, work) => {
  process.stdout.write(`\n→ ${name}\n`);
  work();
};

function prerequisites({ contracts = true, frontend: needsFrontend = true } = {}) {
  if (Number(process.versions.node.split(".")[0]) < 22) {
    throw new Error(
      "Node 22 or newer is required. The reproducible CI version is in .node-version.",
    );
  }
  if (!existsSync(join(root, "node_modules/prettier/bin/prettier.cjs"))) {
    throw new Error(
      "Root tooling is missing. Run pnpm install --frozen-lockfile in the repository root.",
    );
  }
  if (contracts && !existsSync(join(root, "lib/forge-std/src/Test.sol"))) {
    throw new Error(
      "Foundry dependencies are missing. Run git submodule update --init --recursive.",
    );
  }
  if (contracts) {
    execute("python3", [
      "-c",
      "import sys; assert sys.version_info >= (3, 10), 'Python 3.10 or newer is required for the independent math oracle'",
    ]);
  }
  if (needsFrontend && !existsSync(join(frontend, "node_modules/.bin/vitest"))) {
    throw new Error(
      "Frontend dependencies are missing. Run pnpm --dir frontend install --frozen-lockfile.",
    );
  }
}

function changedFiles() {
  let baseline = process.env.CHECK_BASE;
  if (baseline && !/^[a-zA-Z0-9_./-]+$/.test(baseline)) {
    throw new Error("CHECK_BASE must be a Git revision, without whitespace or options.");
  }
  if (baseline?.startsWith("-")) throw new Error("CHECK_BASE cannot start with '-'.");
  if (baseline && /^0+$/.test(baseline)) baseline = undefined;
  if (!baseline) {
    for (const candidate of [
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/main",
      "refs/heads/main",
    ]) {
      try {
        baseline = git(root, ["rev-parse", "--verify", `${candidate}^{commit}`]).trim();
        break;
      } catch {
        // A newly cloned repository may not have every conventional tracking ref.
      }
    }
  }
  if (!baseline)
    baseline = git(root, ["rev-list", "--max-parents=0", "HEAD"]).trim().split("\n")[0];
  const tracked = gitFiles(root, ["diff", "--name-only", "--diff-filter=ACMR", baseline]);
  const untracked = gitFiles(root, ["ls-files", "--others", "--exclude-standard"]);
  return [...new Set([...tracked, ...untracked])].filter((file) => existsSync(join(root, file)));
}

function format(files) {
  const candidates = formatCandidates(files);
  if (candidates.length)
    execute(process.execPath, [
      "node_modules/prettier/bin/prettier.cjs",
      "--check",
      "--",
      ...candidates,
    ]);
}

function tooling() {
  execute(process.execPath, [
    "--test",
    "scripts/checks.test.mjs",
    "scripts/local-runtime.test.mjs",
  ]);
}

function contracts() {
  step("Solidity formatting", () => forge(["fmt", "--check"]));
  step("Production compiler build and contract sizes", () => forge(["build", "--sizes"]));
  // CI/local default runs do not depend on an optional RPC or silently become fork runs.
  step("Contract unit, fuzz, invariant and attack suites", () =>
    forge(["test", "-vv"], {
      env: { ...process.env, ARBITRUM_RPC_URL: "", FOUNDRY_PROFILE: "default" },
    }),
  );
}

function frontendChecks({ comprehensive = false } = {}) {
  step("Frontend lint", () => pnpm(["--dir", "frontend", "lint"]));
  step("Frontend typecheck", () => pnpm(["--dir", "frontend", "typecheck"]));
  step("Frontend unit, property, differential and component tests", () =>
    pnpm(["--dir", "frontend", comprehensive ? "test:coverage" : "test"]),
  );
  if (comprehensive) step("Frontend production build", () => pnpm(["--dir", "frontend", "build"]));
}

function vectors() {
  for (const [generator, contract, output] of [
    ["script/GenerateVectors.s.sol", "GenerateVectors", "contract-vectors.json"],
    ["script/GenerateSharedVectors.s.sol", "GenerateSharedVectors", "shared-contract-vectors.json"],
  ]) {
    const fixture = join(frontend, "src/test/fixtures", output);
    step(`Contract/frontend differential fixture consistency: ${output}`, () =>
      verifyGeneratedFixture(fixture, () =>
        forge(["script", generator, "--tc", contract], {
          env: { ...process.env, ARBITRUM_RPC_URL: "", FOUNDRY_PROFILE: "default" },
        }),
      ),
    );
  }
  step("Independent logarithm oracle corruption regression tests", () =>
    execute("python3", ["scripts/check-log-bounds.py", "--self-test"]),
  );
  step("Independent 170-digit verification of actual Solidity logarithm intervals", () =>
    execute("python3", ["scripts/check-log-bounds.py"]),
  );
}

function audit() {
  step("Root dependency security audit (high and critical)", () =>
    pnpm(["audit", "--audit-level", "high"]),
  );
  step("Frontend dependency security audit (high and critical)", () =>
    pnpm(["--dir", "frontend", "audit", "--audit-level", "high"]),
  );
  step("Production dependency security audit (all reported severities)", () =>
    pnpm(["--dir", "frontend", "audit", "--prod", "--audit-level", "low"]),
  );
}

try {
  if (mode === "hooks") {
    execute("git", ["config", "--local", "core.hooksPath", ".githooks"]);
    process.stdout.write("Installed repository pre-commit and pre-push hooks.\n");
  } else if (mode === "setup") {
    const pinned = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).packageManager;
    process.stdout.write(`Installing locked dependencies with ${pinned}.\n`);
    execute("git", ["submodule", "update", "--init", "--recursive"]);
    pnpm(["install", "--frozen-lockfile"]);
    pnpm(["--dir", "frontend", "install", "--frozen-lockfile"]);
    execute("git", ["config", "--local", "core.hooksPath", ".githooks"]);
  } else if (mode === "pre-commit") {
    const files = gitFiles(root, ["diff", "--cached", "--name-only", "--no-renames"]);
    const scopes = classifyChanges(files);
    prerequisites({ contracts: scopes.contracts || scopes.frontend, frontend: scopes.frontend });
    step("Staged contents and whitespace", () => {
      assertStagedMatchesWorktree(root, files);
      execute("git", ["diff", "--cached", "--check"]);
    });
    step("Formatting staged files", () =>
      format(files.filter((file) => existsSync(join(root, file)))),
    );
    step("Developer gate regression tests", tooling);
    if (scopes.contracts) contracts();
    if (scopes.frontend) frontendChecks();
    if (scopes.contracts || scopes.frontend) vectors();
  } else if (mode === "pre-push") {
    if (process.env.CHAOS_ZERO_PUSH_HOOK === "1") {
      assertCleanPushTree(root);
      const head = git(root, ["rev-parse", "HEAD"]).trim();
      assertPushReferencesMatchHead(readFileSync(0, "utf8"), head, (objectId) =>
        git(root, ["rev-parse", "--verify", `${objectId}^{commit}`]).trim(),
      );
    }
    prerequisites();
    step("Working tree whitespace", () => execute("git", ["diff", "--check"]));
    step("Formatting changed files", () => format(changedFiles()));
    step("Developer gate regression tests", tooling);
    contracts();
    vectors();
    frontendChecks({ comprehensive: true });
    step("Browser flows against disposable local contracts", () => pnpm(["test:e2e"]));
    audit();
  } else if (mode === "contracts") {
    prerequisites({ frontend: false });
    tooling();
    contracts();
    vectors();
  } else if (mode === "frontend") {
    prerequisites({ contracts: false });
    tooling();
    format(changedFiles());
    frontendChecks({ comprehensive: true });
    audit();
  } else if (mode === "format") {
    prerequisites({ contracts: false, frontend: false });
    format(changedFiles());
  } else if (mode === "vectors") {
    prerequisites({ frontend: false });
    vectors();
  } else if (mode === "audit") {
    audit();
  } else if (mode === "heavy") {
    prerequisites({ frontend: false });
    const seed = process.env.FOUNDRY_FUZZ_SEED || `0x${randomBytes(32).toString("hex")}`;
    process.stdout.write(
      `Heavy fuzz/invariant seed: ${seed}\nReproduce: FOUNDRY_FUZZ_SEED=${seed} pnpm test:heavy\n`,
    );
    forge(["test", "-vvv"], {
      env: {
        ...process.env,
        FOUNDRY_PROFILE: "heavy",
        FOUNDRY_FUZZ_SEED: seed,
        ARBITRUM_RPC_URL: "",
      },
    });
  } else {
    throw new Error(`Unknown check mode: ${mode}`);
  }
} catch (error) {
  process.stderr.write(`\nCheck failed: ${error.message}\n`);
  process.exitCode = 1;
}
