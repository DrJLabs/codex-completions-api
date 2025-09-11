import { beforeAll, afterAll, test, expect } from "vitest";
import getPort from "get-port";
import { spawn } from "node:child_process";

let PORT;
let child;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForHealth(timeoutMs = 5000) {
  const started = Date.now();
  while (true) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (r.ok) return;
    } catch {}
    if (Date.now() - started > timeoutMs) throw new Error("health timeout");
    await wait(100);
  }
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
  } catch {}
});

test("HEAD /v1/completions responds 200 with JSON content-type", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/v1/completions`, { method: "HEAD" });
  expect(r.status).toBe(200);
  const ct = r.headers.get("content-type") || "";
  expect(ct.toLowerCase()).toContain("application/json");
  expect(ct.toLowerCase()).toContain("charset=utf-8");
});

test("OPTIONS /v1/completions exposes Allow header", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/v1/completions`, {
    method: "OPTIONS",
    headers: { Origin: "http://example.com", "Access-Control-Request-Method": "POST" },
  });
  expect([200, 204]).toContain(r.status);
  if (r.status === 200) {
    const allow = (r.headers.get("allow") || "").toUpperCase();
    expect(allow).toContain("POST");
    expect(allow).toContain("HEAD");
    expect(allow).toContain("OPTIONS");
  } else {
    const acao = r.headers.get("access-control-allow-origin");
    expect(acao).toBeTruthy();
  }
});
