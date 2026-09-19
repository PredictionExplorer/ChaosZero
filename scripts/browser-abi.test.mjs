import assert from "node:assert/strict";
import test from "node:test";
import { assertAbiSubset } from "./browser-abi.mjs";

const fn = () => ({
  type: "function",
  name: "state",
  stateMutability: "view",
  inputs: [{ type: "uint256", name: "round" }],
  outputs: [
    {
      type: "tuple[8]",
      components: [
        { type: "uint256", name: "cash" },
        { type: "uint16", name: "price" },
      ],
    },
  ],
});

test("ABI checks accept parameter names and internal Solidity types without changing wire types", () => {
  const actual = fn();
  actual.inputs[0].name = "cycleId";
  actual.inputs[0].internalType = "uint256";
  assert.doesNotThrow(() => assertAbiSubset("market", [fn()], [actual]));
});
test("ABI checks reject changed return values, tuple fields, fixed lengths and mutability", () => {
  for (const mutate of [
    (item) => {
      item.outputs = [];
    },
    (item) => {
      item.outputs[0].components[1].type = "uint256";
    },
    (item) => {
      item.outputs[0].components[0].name = "winningSupply";
    },
    (item) => {
      item.outputs[0].type = "tuple[7]";
    },
    (item) => {
      item.stateMutability = "nonpayable";
    },
  ]) {
    const actual = fn();
    mutate(actual);
    assert.throws(() => assertAbiSubset("market", [fn()], [actual]), /market.state/);
  }
});
test("ABI checks allow bubbled errors but do not borrow missing functions from another contract", () => {
  const error = { type: "error", name: "TokenFailure", inputs: [{ type: "uint256" }] };
  assert.doesNotThrow(() => assertAbiSubset("market", [error], [], [[error]]));
  assert.throws(() => assertAbiSubset("market", [fn()], [], [[fn()]]), /ABI drift/);
});
test("ABI checks enforce event indexing and anonymity", () => {
  const event = {
    type: "event",
    name: "Funded",
    inputs: [{ type: "uint256", indexed: true }],
    anonymous: false,
  };
  assert.doesNotThrow(() => assertAbiSubset("market", [event], [structuredClone(event)]));
  const changed = structuredClone(event);
  changed.inputs[0].indexed = false;
  assert.throws(() => assertAbiSubset("market", [event], [changed]), /Funded/);
  changed.inputs[0].indexed = true;
  changed.anonymous = true;
  assert.throws(() => assertAbiSubset("market", [event], [changed]), /Funded/);
});
