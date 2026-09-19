import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const parameterShape = (parameter, event = false, tupleMember = false) => ({
  type: parameter.type,
  // Viem decodes named structs as objects. A field rename/order change between
  // equal Solidity types must not silently swap the browser's cash/liabilities.
  ...(tupleMember ? { name: parameter.name ?? "" } : {}),
  ...(parameter.components
    ? { components: parameter.components.map((item) => parameterShape(item, false, true)) }
    : {}),
  ...(event ? { indexed: Boolean(parameter.indexed) } : {}),
});
const signatureShape = (item) => ({
  type: item.type,
  name: item.name,
  inputs: item.inputs?.map((parameter) => parameterShape(parameter, item.type === "event")),
  ...(item.type === "function"
    ? {
        outputs: item.outputs.map((parameter) => parameterShape(parameter)),
        stateMutability: item.stateMutability,
      }
    : {}),
  ...(item.type === "event" ? { anonymous: Boolean(item.anonymous) } : {}),
});

/** Check every declared browser signature, including return tuples and event indexing. */
export function assertAbiSubset(name, browserAbi, compiledAbi, bubbledAbis = []) {
  for (const item of browserAbi) {
    const candidates =
      item.type === "error" ? [...compiledAbi, ...bubbledAbis.flat()] : compiledAbi;
    assert.ok(
      candidates.some(
        (candidate) =>
          JSON.stringify(signatureShape(candidate)) === JSON.stringify(signatureShape(item)),
      ),
      `Browser/Solidity ABI drift: ${name}.${item.name}`,
    );
  }
}

/** Parse literal signatures without executing repository TypeScript. */
export async function readBrowserAbi(root, sourceFile, exportName) {
  const require = createRequire(path.join(root, "frontend/package.json"));
  const ts = require("typescript");
  const { parseAbi } = require("viem");
  const source = ts.createSourceFile(
    sourceFile,
    await readFile(path.join(root, sourceFile), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const declaration = source.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((entry) => ts.isIdentifier(entry.name) && entry.name.text === exportName);
  const call = declaration?.initializer;
  assert.ok(call && ts.isCallExpression(call), `Missing browser ABI: ${exportName}`);
  assert.equal(call.expression.getText(source), "parseAbi");
  const definitions = call.arguments[0];
  assert.ok(definitions && ts.isArrayLiteralExpression(definitions));
  return parseAbi(
    definitions.elements.map((element) => {
      assert.ok(ts.isStringLiteral(element), "Browser ABI must use reviewable literal signatures");
      return element.text;
    }),
  );
}
