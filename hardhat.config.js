import hardhatVerify from "@nomicfoundation/hardhat-verify";

// No credentials or live signing accounts belong in this file. The deployment
// command creates its RPC/verification configuration in memory after compilation.
export const productionCompiler = {
  version: "0.8.35",
  settings: {
    optimizer: { enabled: true, runs: 1_000_000 },
    viaIR: true,
    evmVersion: "osaka",
  },
};

export default {
  plugins: [hardhatVerify],
  paths: {
    sources: "./src",
    tests: { solidity: "./.local/hardhat-tests" },
    cache: "./.local/hardhat-cache",
    artifacts: "./.local/hardhat-artifacts",
  },
  solidity: {
    profiles: {
      default: productionCompiler,
      production: productionCompiler,
    },
  },
  verify: {
    etherscan: { enabled: false },
    blockscout: { enabled: false },
    sourcify: { enabled: false },
  },
};
