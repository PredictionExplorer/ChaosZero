import assert from "node:assert/strict";
import { test } from "node:test";
import { compareRuntimeBytecode, stripCompilerMetadata } from "./compiler-parity.mjs";

const runtime = (code = "6001600055fe", digest = "11") =>
  `0x${code}a2646970667358221220${digest.repeat(32)}64736f6c63430008230033`;

test("compiler metadata differences are permitted without ignoring executable bytes", () => {
  assert.equal(stripCompilerMetadata(runtime()), "0x6001600055fe");
  assert.doesNotThrow(() => compareRuntimeBytecode(runtime(), runtime(undefined, "ab"), "Market"));
  assert.doesNotThrow(() =>
    compareRuntimeBytecode(runtime(), runtime().toUpperCase().replace("0X", "0x")),
  );
});

test("different executable instructions, length or immutable placeholders fail parity", () => {
  for (const code of ["6002600055fe", "6001600055", "6001600055fe00"])
    assert.throws(
      () => compareRuntimeBytecode(runtime(), runtime(code), "Market"),
      /runtime mismatch: Market/,
    );
});

test("missing bytecode and malformed, truncated or unrecognized metadata fail closed", () => {
  for (const invalid of [
    undefined,
    "",
    "0x",
    "0xzz",
    "0x123",
    "0x6001600055fe",
    runtime().slice(0, -4) + "ffff",
    runtime().slice(0, -4) + "0000",
    runtime().slice(0, -4) + "0032",
    runtime().replace("a26469706673", "a16469706673"),
    runtime().replace("58221220", "58221221"),
  ])
    assert.throws(() => stripCompilerMetadata(invalid), /bytecode|metadata/);
});
