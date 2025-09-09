import js from "@eslint/js";
import globals from "globals";
import playwright from "eslint-plugin-playwright";
import security from "eslint-plugin-security";
import { FlatCompat } from "@eslint/eslintrc";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({ baseDirectory: __dirname });
const pwRecommended = playwright.configs?.["flat/recommended"] ?? {};

export default [
  js.configs.recommended,
  // Bring back plugin recommended sets from legacy extends via compat
  ...compat.extends(
    "plugin:import/recommended",
    "plugin:n/recommended",
    "plugin:promise/recommended"
  ),
  {
    name: "base",
    files: ["**/*.{js,mjs,cjs}"],
    ignores: [
      "node_modules/**",
      "web-bundles/**",
      "playwright-report/**",
      "test-results/**",
      ".codev/**",
      ".codex-api/**",
    ],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    // Plugins only needed here for additional rules beyond recommended
    plugins: { security },
    rules: {
      "no-console": "off",
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-empty": "off",
      "no-control-regex": "off",
      "import/order": "off",
      "n/no-unsupported-features/es-syntax": "off",
      "n/no-process-exit": "off",
      "n/hashbang": "off",
    },
  },
  // Vitest + integration tests (non-Playwright)
  {
    name: "vitest-and-integration",
    files: ["tests/unit/**/*.js", "tests/integration/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.node,
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
      },
    },
    rules: {
      // Keep prior behavior from legacy config
      "promise/param-names": "off",
      "no-console": "off",
    },
  },
  // Playwright E2E tests only
  {
    name: "playwright-e2e",
    files: ["tests/*.spec.js"],
    ...pwRecommended,
    languageOptions: {
      globals: {
        ...globals.node,
        ...(playwright.environments?.playwright?.globals || {}),
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
      },
    },
    rules: {
      ...(pwRecommended.rules || {}),
      // mirror prior config: allow conditionals in tests
      "playwright/no-conditional-in-test": "off",
      "no-console": "off",
    },
  },
  // Keep Prettier as the last config to disable stylistic ESLint rules
  ...compat.extends("prettier"),
];
