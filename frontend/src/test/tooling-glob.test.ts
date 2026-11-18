/** @vitest-environment node */
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { build } from "vite";

const local = createRequire(import.meta.url);
const vite = createRequire(local.resolve("vite"));
const matcher = vite("picomatch") as {
  (patterns: string | string[], options?: Record<string, unknown>): (path: string) => boolean;
  isMatch(path: string, patterns: string | string[], options?: Record<string, unknown>): boolean;
  scan(pattern: string): { base: string; isGlob: boolean; parts: string[]; negated: boolean };
};

it("shares the bounded tooling matcher with build, discovery, and test coverage", () => {
  const vitest = createRequire(local.resolve("vitest"));
  const tinyglobby = createRequire(vite.resolve("tinyglobby"));
  const fdir = createRequire(tinyglobby.resolve("fdir"));
  const entry = vite.resolve("picomatch");
  expect(vitest.resolve("picomatch")).toBe(entry);
  expect(tinyglobby.resolve("picomatch")).toBe(entry);
  expect(fdir.resolve("@chaos-zero/tooling-glob")).toBe(entry);
  expect(matcher(["**/.env", "**/.env.*"], { dot: true, nocase: true })("/APP/.ENV.LOCAL")).toBe(
    true,
  );
  expect(matcher(["src/**/*.{ts,tsx}"], { ignore: ["**/*.test.*"] })("src/sub/panel.tsx")).toBe(
    true,
  );
  expect(
    matcher(["src/**/*.{ts,tsx}"], { ignore: ["**/*.test.*"] })("src/sub/panel.test.tsx"),
  ).toBe(false);
  expect(matcher([], {})("src/sub/panel.tsx")).toBe(false);
  expect(matcher("!(draft).ts")("final.ts")).toBe(true);
  expect(matcher("!(draft).ts")("draft.ts")).toBe(false);
  expect(matcher("**/node_modules/**")("/app/node_modules")).toBe(true);
  expect(matcher.isMatch("/app/src/hooks/file.tsx", "src/hooks/**", { contains: true })).toBe(true);
  expect(matcher.isMatch("/app/src/lib/file.tsx", "src/hooks/**", { contains: true })).toBe(false);
  expect(matcher.scan("src/{one,two/three}/**")).toMatchObject({
    base: "src",
    parts: ["src", "{one,two/three}", "**"],
    isGlob: true,
  });
  expect(matcher.scan("!./src/file.ts")).toMatchObject({
    base: "src/file.ts",
    isGlob: false,
    negated: true,
  });
});

it("lets Rolldown recognize Vite custom asset globs in a production bundle", async () => {
  const root = await mkdtemp(join(tmpdir(), "chaos-vite-asset-"));
  try {
    await writeFile(join(root, "entry.js"), 'export { default as asset } from "./sample.orbit";');
    await writeFile(join(root, "sample.orbit"), "asset text");
    const output = await build({
      configFile: false,
      root,
      logLevel: "silent",
      assetsInclude: ["**/*.orbit"],
      build: { lib: { entry: join(root, "entry.js"), formats: ["es"] }, write: false },
    });
    const bundles = Array.isArray(output) ? output : [output];
    expect(
      bundles
        .flatMap((result) => ("output" in result ? result.output : []))
        .some((chunk) => chunk.type === "chunk" && chunk.code.includes("base64,")),
    ).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
