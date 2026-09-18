import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw new Error(`Cannot run ${command}: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.signal ?? result.status}).`);
  }
}

export function git(repoRoot, args) {
  const result = spawnSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message ?? result.stderr.trim() ?? "Git command failed.");
  }
  return result.stdout;
}

export function gitFiles(repoRoot, args) {
  return git(repoRoot, [...args, "-z"])
    .split("\0")
    .filter(Boolean);
}

export function assertContractDependencies(repoRoot) {
  const dependencies = [
    ["forge-std", "lib/forge-std/src/Test.sol"],
    ["OpenZeppelin ERC1155", "lib/openzeppelin-contracts/contracts/token/ERC1155/ERC1155.sol"],
  ];
  const missing = dependencies.filter(([, path]) => !existsSync(join(repoRoot, path)));
  if (missing.length) {
    throw new Error(
      `Foundry dependencies are missing (${missing.map(([name]) => name).join(", ")}). Run git submodule update --init --recursive.`,
    );
  }
}

export function classifyChanges(files) {
  const tooling = files.some((file) =>
    /^(?:scripts\/|\.githooks\/|\.github\/|playwright\.config\.|package\.json$|pnpm-lock\.yaml$|\.node-version$|\.prettier)/.test(
      file,
    ),
  );
  return {
    contracts:
      tooling ||
      files.some((file) =>
        /^(?:src\/|test\/|script\/|lib\/|foundry\.(?:toml|lock)$|\.gitmodules$)/.test(file),
      ),
    frontend: tooling || files.some((file) => /^(?:frontend\/|e2e\/)/.test(file)),
    tooling,
  };
}

export function assertStagedMatchesWorktree(repoRoot, staged) {
  const unstaged = new Set(gitFiles(repoRoot, ["diff", "--name-only"]));
  const conflicts = new Set(staged.filter((file) => unstaged.has(file)));
  const scope = classifyChanges(staged);
  if (scope.contracts || scope.frontend) {
    const untracked = gitFiles(repoRoot, ["ls-files", "--others", "--exclude-standard"]);
    for (const file of [...unstaged, ...untracked]) {
      const fileScope = classifyChanges([file]);
      if (fileScope.contracts || fileScope.frontend) conflicts.add(file);
    }
  }
  if (conflicts.size > 0) {
    throw new Error(
      `The tested sources contain unstaged changes:\n${[...conflicts].join("\n")}\nStage the complete intended versions before checking. Otherwise the tests would validate different code from the commit.`,
    );
  }
}

export function assertPushReferencesMatchHead(input, head, resolveCommit) {
  for (const line of input.trim().split("\n").filter(Boolean)) {
    const [reference, objectId] = line.trim().split(/\s+/);
    if (/^0+$/.test(objectId)) continue; // A ref deletion publishes no new code.
    if (!/^[0-9a-f]{40,64}$/i.test(objectId) || resolveCommit(objectId) !== head) {
      throw new Error(
        `The push includes ${reference}, which does not point at the checked-out commit. Check out that revision and run its checks before pushing it.`,
      );
    }
  }
}

export function assertCleanPushTree(repoRoot) {
  if (git(repoRoot, ["status", "--porcelain"]).trim()) {
    throw new Error(
      "The push hook requires a clean working tree so its checks test the exact commit being pushed. Use pnpm check to validate work in progress, then commit the complete change before pushing.",
    );
  }
}

export function formatCandidates(files) {
  return files.filter(
    (file) =>
      /\.(?:[cm]?[jt]sx?|json|ya?ml|md|css)$/.test(file) &&
      !/^(?:lib\/|broadcast\/|out\/|cache\/)/.test(file) &&
      !/(?:^|\/)(?:pnpm-lock\.yaml|next-env\.d\.ts)$/.test(file) &&
      !/^frontend\/src\/(?:lib\/abi\/|test\/fixtures\/)/.test(file),
  );
}

// The generator intentionally targets a checked-in fixture. Preserve the original
// bytes even when Forge exits unsuccessfully, so a check never edits that fixture.
export function verifyGeneratedFixture(fixture, generate) {
  const original = readFileSync(fixture);
  let generated;
  try {
    generate();
    generated = readFileSync(fixture);
  } finally {
    writeFileSync(fixture, original);
  }
  if (!original.equals(generated)) {
    throw new Error(
      `Contract-generated fixtures differ from ${fixture}. Regenerate them, review the change, and include it with the contract/frontend update.`,
    );
  }
}
