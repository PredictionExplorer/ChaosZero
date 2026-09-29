import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Test and coverage artifacts:
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "blob-report/**",
  ]),
  // Last: turn off every stylistic rule that would fight Prettier, which owns
  // formatting (`pnpm format`).
  prettier,
]);

export default eslintConfig;
