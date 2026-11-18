// @vitest-environment node
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

// Follow the same dependency edges as the production connector. Root/dev
// copies can legitimately differ from the matcher used by WalletConnect.
const app = createRequire(import.meta.url);
const provider = createRequire(app.resolve("@walletconnect/ethereum-provider"));
const keyValueStorage = createRequire(provider.resolve("@walletconnect/keyvaluestorage"));
const unstorage = createRequire(keyValueStorage.resolve("unstorage"));

interface WalletStore {
  getItem(key: string): Promise<unknown>;
  setItem(key: string, value: unknown): Promise<void>;
  removeItem(key: string): Promise<void>;
  getKeys(): Promise<string[]>;
  getEntries(): Promise<[string, unknown][]>;
}
const { KeyValueStorage } = provider("@walletconnect/keyvaluestorage") as {
  KeyValueStorage: new (options: { database: string }) => WalletStore;
};
const filesystemDriver = keyValueStorage("unstorage/drivers/fs") as (options: {
  base: string;
  ignore?: string[];
}) => { getKeys(): Promise<string[]> };

describe("the wallet connector's storage dependencies", () => {
  it("round-trips a session in the memory and filesystem stores", async () => {
    const directory = await mkdtemp(join(tmpdir(), "axiom-wallet-"));
    const key = "wc@2:client:session";
    const session = { topic: "storage-test", chains: ["eip155:42161"] };
    try {
      for (const database of [":memory:", directory]) {
        const store = new KeyValueStorage({ database });
        await store.setItem(key, session);
        expect(await store.getItem(key)).toEqual(session);
        expect(await store.getKeys()).toContain(key);
        expect(await store.getEntries()).toContainEqual([key, session]);
        if (database === directory) {
          const file = join(directory, "wc@2", "client", "session");
          expect(JSON.parse(await readFile(file, "utf8"))).toEqual(session);
          expect(await new KeyValueStorage({ database }).getItem(key)).toEqual(session);
        }
        await store.removeItem(key);
        expect(await store.getItem(key)).toBeUndefined();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("retains default traversal exclusions and custom negative, dotfile and brace patterns", async () => {
    const base = await mkdtemp(join(tmpdir(), "axiom-storage-globs-"));
    try {
      for (const key of [
        ".git/index",
        "nested/node_modules/pkg/a.js",
        "keep.txt",
        "build.tmp",
        ".build.tmp",
        "notes.md",
      ]) {
        const name = join(base, key);
        await mkdir(dirname(name), { recursive: true });
        await writeFile(name, key);
      }
      expect((await filesystemDriver({ base }).getKeys()).sort()).toEqual([
        ".build.tmp",
        "build.tmp",
        "keep.txt",
        "notes.md",
      ]);
      const ignore = ["**/node_modules/**", "**/.git/**", "*.{tmp,txt}", "!keep.txt"];
      expect((await filesystemDriver({ base, ignore }).getKeys()).sort()).toEqual([
        "keep.txt",
        "notes.md",
      ]);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("normalizes Windows paths and preserves non-string matchers and indexed lookups", () => {
    type Pattern = string | RegExp | ((value: string) => boolean);
    const match = unstorage("anymatch") as {
      (patterns: Pattern[], value: string, index?: false): boolean;
      (patterns: Pattern[], value: string, index: true): number;
    };
    expect(match(["**/node_modules/**"], "C:\\work\\node_modules")).toBe(true);
    expect(match([/^\./, (name) => name === "README"], "README")).toBe(true);
    expect(match([/^\./], ".env")).toBe(true);
    expect(match(["*.md", "*.txt"], "notes.txt", true)).toBe(1);
  });
});
