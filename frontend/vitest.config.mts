import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // Test isolation: no call history, spies, stubbed env vars or globals leak
    // from one test into the next.
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/test/**"],
      // text: the terminal table · lcov: lcov.info for CI/Codecov plus a
      // browsable HTML report in coverage/lcov-report · json-summary: totals
      // for CI job summaries and badges.
      reporter: ["text", "lcov", "json-summary"],
      reportsDirectory: "./coverage",
      // A ratchet, not a target: each floor sits at (or just under) what the
      // suite achieves today, so coverage can only go up. Raise a number when
      // coverage improves — `COVERAGE_RATCHET=1 pnpm test:coverage` rewrites
      // these floors to the achieved values, rounded down — and never lower one
      // to land a change.
      thresholds: {
        autoUpdate: process.env.COVERAGE_RATCHET
          ? (achieved: number) => Math.floor(achieved)
          : false,
        statements: 98,
        branches: 96,
        functions: 99,
        lines: 99,
        // The math that mirrors the contract (pricing, fees, pool replay,
        // config parsing, error decoding) is held to a stricter bar than the
        // UI around it. Files here also count toward the global floors.
        "src/lib/**": {
          statements: 99,
          branches: 98,
          functions: 100,
          lines: 99,
        },
      },
    },
  },
});
