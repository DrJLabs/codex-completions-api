import { test, expect, beforeAll, afterAll } from "vitest";
import getPort from "get-port";
import { spawn } from "node:child_process";
import fetch from "node-fetch";

let PORT;
let child;

beforeAll(async () => {
  PORT = await getPort();
  child = spawn("node", ["server.js"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      PROXY_API_KEY: "test-sk-ci",
      CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
      PROXY_PROTECT_MODELS: "false",
    },
    stdio: "ignore",
  });
  // wait for health
  const start = Date.now();
  while (Date.now() - start < 5000) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (r.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
}, 10_000);

afterAll(async () => {
  if (child && !child.killed) {
    try {
      child.kill("SIGTERM");
    } catch {}
  }
});

test("HEAD /v1/chat/completions responds 200", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: "HEAD",
    headers: { Authorization: "Bearer test-sk-ci" },
  });
  expect(r.status).toBe(200);
});

test("OPTIONS /v1/chat/completions exposes CORS", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: "OPTIONS",
    headers: { Origin: "http://example.com", "Access-Control-Request-Method": "POST" },
  });
  expect([200, 204]).toContain(r.status);
  const acao = r.headers.get
    ? r.headers.get("access-control-allow-origin")
    : r.headers["access-control-allow-origin"];
  expect(acao).toBeTruthy();
});
