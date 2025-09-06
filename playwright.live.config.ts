import { defineConfig } from "@playwright/test";

// Live E2E config: does NOT spawn a local server.
// Points to an already running proxy (local compose or edge).

const BASE = process.env.LIVE_BASE_URL || "http://127.0.0.1:11435";
const KEY = process.env.KEY || process.env.PROXY_API_KEY || "";

export default defineConfig({
  testDir: "tests",
  testMatch: ["tests/live.*.spec.*"],
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "list" : [["html", { open: "never" }]],
  use: {
    baseURL: BASE,
    extraHTTPHeaders: {
      ...(KEY ? { Authorization: `Bearer ${KEY}` } : {}),
      "Content-Type": "application/json",
    },
  },
});

