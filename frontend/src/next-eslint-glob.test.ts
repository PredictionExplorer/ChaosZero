/** @vitest-environment node */
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import { afterAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const configRequire = createRequire(require.resolve("eslint-config-next"));
const pluginEntry = configRequire.resolve("@next/eslint-plugin-next");
const pluginRequire = createRequire(pluginEntry);
const distribution = dirname(pluginEntry);
const { getRootDirs } = pluginRequire(join(distribution, "utils/get-root-dirs.js"));
const temporary = mkdtempSync(join(tmpdir(), "chaos-next-roots-"));
for (const name of ["web", "admin", "docs", ".hidden"]) mkdirSync(join(temporary, name));
writeFileSync(join(temporary, "ordinary-file"), "not a directory");
afterAll(() => rmSync(temporary, { recursive: true, force: true }));
const roots = (rootDir?: string | string[]) =>
  getRootDirs({ cwd: process.cwd(), settings: { next: rootDir === undefined ? {} : { rootDir } } })
    .map((path: string) => resolve(path))
    .sort();

function javascriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? javascriptFiles(path) : entry.name.endsWith(".js") ? [path] : [];
  });
}

describe("Next ESLint's narrowly replaced directory glob dependency", () => {
  it("pins the inspected consumer and verifies that globSync is its only fast-glob API", () => {
    const pkg = JSON.parse(readFileSync(join(distribution, "../package.json"), "utf8"));
    expect(pkg.version).toBe("16.3.8");
    const imports = javascriptFiles(distribution).filter((path) =>
      readFileSync(path, "utf8").includes('require("fast-glob")'),
    );
    expect(imports).toEqual([join(distribution, "utils/get-root-dirs.js")]);
    const source = readFileSync(imports[0], "utf8");
    expect([...source.matchAll(/_fastglob\.([A-Za-z]+)/g)].map((match) => match[1])).toEqual([
      "globSync",
    ]);
    expect(source).toContain("onlyDirectories: true");
    const implementation = pluginRequire.resolve("fast-glob");
    const actualPackage = JSON.parse(
      readFileSync(join(dirname(implementation), "../package.json"), "utf8"),
    );
    expect(actualPackage.name).toBe("tinyglobby");
    expect(actualPackage.version).toBe("0.2.17");
    expect(typeof pluginRequire("fast-glob").globSync).toBe("function");
    expect(readFileSync(resolve(process.cwd(), "pnpm-lock.yaml"), "utf8")).not.toMatch(
      /^\s+braces@/m,
    );
  });
  it("preserves the default, literal, wildcard, array and directory-only root discovery", () => {
    expect(roots()).toEqual([process.cwd()]);
    expect(roots(join(temporary, "web"))).toEqual([join(temporary, "web")]);
    expect(roots(join(temporary, "*"))).toEqual(
      ["admin", "docs", "web"].map((name) => join(temporary, name)),
    );
    expect(roots([join(temporary, "web"), join(temporary, "admin")])).toEqual(
      ["admin", "web"].map((name) => join(temporary, name)),
    );
    expect(roots(join(temporary, "ordinary-file"))).toEqual([]);
    expect(roots(relative(process.cwd(), join(temporary, "web")))).toEqual([
      join(temporary, "web"),
    ]);
  });
  it("preserves normal nested brace selection without pulling in braces", () => {
    expect(roots(join(temporary, "{web,{admin,docs}}"))).toEqual(
      ["admin", "docs", "web"].map((name) => join(temporary, name)),
    );
  });
  it("handles the advisory's deeply nested input without recursive-AST stack exhaustion", () => {
    const pattern = `${"{".repeat(10_000)}missing-a,missing-b${"}".repeat(10_000)}`;
    expect(roots(join(temporary, pattern))).toEqual([]);
  }, 15_000);
});
