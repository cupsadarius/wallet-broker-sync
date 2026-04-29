import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

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
    // Project-specific: don't lint user-supplied broker exports (gitignored)
    // or browser-saved asset folders that come with HTML "Save As" exports.
    "sources/**",
    "docs/superpowers/captures/**",
  ]),
]);

export default eslintConfig;
