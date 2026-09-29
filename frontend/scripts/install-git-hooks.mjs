// Installs the lefthook git hooks (config: ../lefthook.yml) on a developer's
// `pnpm install`. It must never fail an install, and it is a deliberate no-op
// where hooks make no sense: CI, Vercel builds (which run `pnpm install` in
// this directory), and exports without a git work tree.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const enabled = (value) => !!value && value !== "0" && value !== "false";
if (enabled(process.env.CI) || enabled(process.env.VERCEL)) process.exit(0);

let insideWorkTree = "";
try {
  insideWorkTree = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
} catch {
  // git missing or not a repository
}
if (insideWorkTree.trim() !== "true") process.exit(0);

try {
  const lefthook = createRequire(import.meta.url).resolve("lefthook/bin/index.js");
  execFileSync(process.execPath, [lefthook, "install"], { stdio: "inherit" });
} catch {
  console.warn("lefthook: git hooks not installed (see above); retry with `make hooks`");
}
