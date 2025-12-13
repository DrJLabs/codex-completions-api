import { beforeAll, afterAll, test, expect } from "vitest";
import getPort from "get-port";
import { spawn } from "node:child_process";

let PORT;
let child;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForHealth(timeoutMs = 5000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (r.ok) return;
    } catch (e) {
      lastError = e;
    }
    await wait(100);
  }
  throw new Error(`Health check timed out after ${timeoutMs}ms. Last error: ${lastError}`);
}

beforeAll(async () => {
  PORT = await getPort();
  child = spawn("node", ["server.js"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      PROXY_API_KEY: "test-sk-ci",
      CODEX_BIN: "scripts/fake-codex-proto.js",
      PROXY_PROTECT_MODELS: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForHealth();
});

afterAll(async () => {
  try {
    if (child && !child.killed) child.kill("SIGTERM");
  } catch (e) {
    console.error("Failed to terminate child process in afterAll:", e);
  }
});

test("HEAD /v1/completions responds 200 with JSON content-type", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/v1/completions`, {
    method: "HEAD",
    headers: { Authorization: "Bearer test-sk-ci" },
  });
  expect(r.status).toBe(200);
  const ct = r.headers.get("content-type") || "";
  expect(ct.toLowerCase()).toContain("application/json");
  expect(ct.toLowerCase()).toContain("charset=utf-8");
});

test("OPTIONS /v1/completions responds 204 preflight with CORS headers", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/v1/completions`, {
    method: "OPTIONS",
    headers: { Origin: "http://example.com", "Access-Control-Request-Method": "POST" },
  });
  expect(r.status).toBe(204);
  const acao = r.headers.get("access-control-allow-origin");
  expect(acao).toBeTruthy();
});
