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
        "src/shared/positions.ts": { statements: 98, branches: 95, functions: 100, lines: 99 },
        "src/shared/use-position-recovery.ts": {
          statements: 98,
          branches: 95,
          functions: 100,
          lines: 99,
        },
        "src/shared/independent-math.ts": {
          statements: 98,
          branches: 95,
          functions: 100,
          lines: 99,
        },
        "src/shared/math.ts": { statements: 95, branches: 95, functions: 100, lines: 99 },
        "src/hooks/use-market.ts": { statements: 98, branches: 95, functions: 100, lines: 99 },
        "src/hooks/use-market-actions.ts": {
          statements: 98,
          branches: 95,
          functions: 100,
          lines: 99,
        },
        "src/shared/use-shared-market.ts": {
          statements: 98,
          branches: 95,
          functions: 100,
          lines: 99,
        },
      },
      include: ["src/lib/**", "src/components/**", "src/hooks/**", "src/shared/**"],
    },
  },
});
