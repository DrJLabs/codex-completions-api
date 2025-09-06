module.exports = {
  root: true,
  env: { node: true, es2022: true },
  parserOptions: { ecmaVersion: 2023, sourceType: "module" },
  plugins: ["import", "n", "promise", "playwright"],
  extends: [
    "eslint:recommended",
    "plugin:import/recommended",
    "plugin:n/recommended",
    "plugin:promise/recommended",
    "plugin:playwright/recommended",
    "prettier",
  ],
  rules: {
    "no-console": "off",
    "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    "no-empty": "off",
    "no-undef": "off",
    "no-control-regex": "off",
    "import/order": "off",
    "n/no-unsupported-features/es-syntax": "off",
    "n/no-process-exit": "off",
    "n/hashbang": "off",
  },
  overrides: [
    { files: ["tests/**/*.js"], rules: { "no-console": "off", "playwright/no-conditional-in-test": "off", "n/no-unsupported-features/node-builtins": "off", "promise/param-names": "off" } },
  ],
};
