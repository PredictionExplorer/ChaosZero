import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The pinned compiler emits an IPFS digest and a three-byte solc version in CBOR. */
export function stripCompilerMetadata(bytecode) {
  if (typeof bytecode !== "string" || !/^0x(?:[0-9a-f]{2})+$/i.test(bytecode))
    throw new Error("Invalid deployed bytecode: expected nonempty hexadecimal bytes");
  const hex = bytecode.slice(2).toLowerCase();
  const length = Number.parseInt(hex.slice(-4), 16) * 2;
  if (length === 0 || length + 4 >= hex.length)
    throw new Error("Missing or truncated compiler metadata");
  const metadata = hex.slice(-length - 4, -4);
  // Validate the complete, length-delimited CBOR map before stripping anything.
  // Unknown future layouts require review, rather than guessing which bytes are code.
  if (!/^a2646970667358221220[0-9a-f]{64}64736f6c6343[0-9a-f]{6}$/.test(metadata))
    throw new Error("Malformed or unsupported compiler metadata");
  return `0x${hex.slice(0, -length - 4)}`;
}

export function compareRuntimeBytecode(foundry, hardhat, contract = "contract") {
  if (stripCompilerMetadata(foundry) !== stripCompilerMetadata(hardhat))
    throw new Error(`Compiler runtime mismatch: ${contract}`);
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const targets = [
    ["GameFundedOutcomeMarket", "GameFundedOutcomeMarket"],
    ["GameFundedMarketViews", "GameFundedMarketViews"],
    ["IndependentOutcomeMarket", "IndependentOutcomeMarket"],
    ["IndependentOutcomeMarket", "IndependentMarketViews"],
    ["OutcomeSettlementVault", "OutcomeSettlementVault"],
    ["V3OutcomeSource", "V3OutcomeSource"],
  ];
  for (const [source, contract] of targets) {
    const [foundry, hardhat] = await Promise.all(
      [
        `out/${source}.sol/${contract}.json`,
        `.local/hardhat-artifacts/src/${source}.sol/${contract}.json`,
      ].map(async (file) => JSON.parse(await readFile(path.join(root, file), "utf8"))),
    );
    compareRuntimeBytecode(foundry.deployedBytecode?.object, hardhat.deployedBytecode, contract);
    // Include metadata in the deployed code size and the successor’s three constructor words in initcode.
    if ((hardhat.deployedBytecode.length - 2) / 2 > 24576)
      throw new Error(`Runtime exceeds EIP-170 size limit: ${contract}`);
    if (
      contract === "GameFundedOutcomeMarket" &&
      (hardhat.bytecode.length - 2) / 2 + 3 * 32 > 49152
    )
      throw new Error("Successor creation exceeds EIP-3860 initcode limit.");
  }
  console.log(
    `Compiler parity passed for all ${targets.length} runtimes, excluding validated CBOR metadata.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
