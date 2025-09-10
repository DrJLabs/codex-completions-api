import { defineConfig } from "vitest/config";

// Keep this minimal to avoid overriding CLI-targeted suites.
// Coverage thresholds enforce health of pure helpers in src/**.
export default defineConfig({
  test: {
    environment: "node",
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json"],
      reportsDirectory: "./coverage",
      all: true,
      include: ["src/**"],
      exclude: ["**/*.d.ts", "tests/**", "dist/**"],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
});
