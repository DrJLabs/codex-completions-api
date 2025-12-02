import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.PORT || 11500);
const HOST = process.env.HOST || "127.0.0.1";
const BASE_HTTP = `http://${HOST}:${PORT}`;

export default defineConfig({
  testDir: "tests",
  testIgnore: ["tests/unit/**", "tests/integration/**", "tests/parity/**", "tests/live.*.spec.*"],
  timeout: 60_000,
  retries: process.env.CI ? 2 : 0,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "list" : [["html", { open: "never" }]],
  use: {
    baseURL: `${BASE_HTTP}`,
    extraHTTPHeaders: {
      Authorization: `Bearer test-sk-ci`,
      "Content-Type": "application/json",
    },
  },
  webServer: {
    command: "node server.js",
    url: `${BASE_HTTP}/healthz`,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: String(PORT),
      PROXY_API_KEY: "test-sk-ci",
      // Use the deterministic app-server JSON-RPC shim for tests to avoid external dependency
      CODEX_BIN: process.env.CODEX_BIN || "scripts/fake-codex-jsonrpc.js",
      PROXY_USE_APP_SERVER: "true",
      CODEX_WORKER_SUPERVISED: "true",
      // Keep models public in tests
      PROXY_PROTECT_MODELS: "false",
      // Allow higher parallel SSE to avoid spurious 429s in CI/local
      PROXY_SSE_MAX_CONCURRENCY: process.env.PROXY_SSE_MAX_CONCURRENCY || "12",
    },
  },
});
