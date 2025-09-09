import js from "@eslint/js";
import globals from "globals";
import importPlugin from "eslint-plugin-import";
import nPlugin from "eslint-plugin-n";
import promisePlugin from "eslint-plugin-promise";
import playwright from "eslint-plugin-playwright";
import security from "eslint-plugin-security";

export default [
  js.configs.recommended,
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
    plugins: {
      import: importPlugin,
      n: nPlugin,
      promise: promisePlugin,
      security,
    },
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
  // Test files (JS only; TS tests are ignored by ESLint here)
  {
    name: "tests",
    files: ["tests/**/*.js"],
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
    plugins: { playwright },
    rules: {
      // mirror prior config: allow conditionals in tests
      "playwright/no-conditional-in-test": "off",
      "no-console": "off",
    },
  },
];
