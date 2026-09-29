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
    coverage: {
      provider: "v8",
      thresholds: {
        "src/independent/models.ts": { statements: 98, branches: 95, functions: 100, lines: 99 },
        "src/independent/use-independent-actions.ts": {
          statements: 98,
          branches: 95,
          functions: 100,
          lines: 99,
        },
        "src/independent/use-independent-market.ts": {
          statements: 98,
          branches: 95,
          functions: 100,
          lines: 99,
        },
        "src/shared/positions.ts": { statements: 98, branches: 95, functions: 100, lines: 99 },
        "src/shared/independent-math.ts": {
          statements: 98,
          branches: 95,
          functions: 100,
          lines: 99,
        },
        // Only log2Bounds remains in math.ts (14 v8 branch arms). The `hi === Q` arm of
        // `if (hi !== Q) upper += 1n` is unreachable for every valid non-power input: an
        // exhaustive backward search from Q finds 15 predecessor states, each with at most
        // 3 trailing zero bits, while a normalized x <= 2^120 has at least 7. The 631-row
        // Solidity corpus hits every other arm, so 13/14 = 92.9% is the maximum.
        "src/shared/math.ts": { statements: 95, branches: 92, functions: 100, lines: 99 },
        "src/hooks/use-market.ts": { statements: 98, branches: 95, functions: 100, lines: 99 },
        "src/hooks/use-market-actions.ts": {
          statements: 98,
          branches: 95,
          functions: 100,
          lines: 99,
        },
      },
      include: [
        "src/lib/**",
        "src/components/**",
        "src/hooks/**",
        "src/shared/**",
        "src/independent/**",
      ],
    },
  },
});
