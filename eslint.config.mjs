import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // CLAUDE.md: "TypeScript strict mode: zero `any`, zero suppressed errors."
    // Make the convention machine-enforced instead of relying on review.
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // CLAUDE.md: "Deterministic-first: NO AI logic in scoring... AI coach
    // lives in its own module: lib/coach/ — never bleeds into scoring."
    // The dependency arrow only ever points coach -> scoring, never back.
    files: ["lib/scoring/**/*.{ts,tsx}", "lib/engine/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["*/coach/*", "*/coach", "@/lib/coach/*", "@/lib/coach"],
              message:
                "Scoring must never import from lib/coach/ — see CLAUDE.md's deterministic-first rule.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
