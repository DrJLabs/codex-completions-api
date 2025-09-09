// Integration tests for Express API using a real child server
// Spawns server.js on a random port with a deterministic proto shim

import { beforeAll, afterAll, test, expect } from "vitest";
import getPort from "get-port";
import { spawn } from "node:child_process";
import { unlinkSync, existsSync } from "node:fs";
import path from "node:path";
import fetch from "node-fetch";

let PORT;
let BASE;
let API_KEY = "test-sk-ci";
let child;
let TOKEN_FILE;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth(timeoutMs = 5000) {
  const start = Date.now();

  while (true) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (res.ok) return;
    } catch {}
    if (Date.now() - start > timeoutMs) throw new Error("health timeout");
    await wait(100);
  }
}

beforeAll(async () => {
  // Use an ephemeral free port to avoid flakiness from collisions with
  // other test runs or system services (e.g., ForwardAuth on 18080).
  PORT = await getPort();
  BASE = `http://127.0.0.1:${PORT}/v1`;
  TOKEN_FILE = path.join(process.cwd(), ".tmp-usage.test.ndjson");
  try {
    if (existsSync(TOKEN_FILE)) unlinkSync(TOKEN_FILE);
  } catch {}
  child = spawn("node", ["server.js"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      PROXY_API_KEY: API_KEY,
      CODEX_BIN: "scripts/fake-codex-proto.js",
      PROXY_PROTECT_MODELS: "false",
      TOKEN_LOG_PATH: TOKEN_FILE,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  await waitForHealth();
});

afterAll(async () => {
  if (child && !child.killed) {
    try {
      child.kill("SIGTERM");
    } catch {}
  }
});

test("healthz ok", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/healthz`);
  expect(r.status).toBe(200);
  const j = await r.json();
  expect(j).toHaveProperty("ok", true);
});

test("models include codex-5", async () => {
  const r = await fetch(`${BASE}/models`);
  expect(r.status).toBe(200);
  const j = await r.json();
  const ids = (j.data || []).map((m) => m.id);
  expect(ids).toContain("codex-5");
});

test("401 without auth on chat completions", async () => {
  const r = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "codex-5",
      stream: false,
      messages: [{ role: "user", content: "hi" }],
    }),
  });
  expect(r.status).toBe(401);
});

test("400 messages required", async () => {
  const r = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: "codex-5", stream: false }),
  });
  expect(r.status).toBe(400);
});

test("404 model_not_found for unknown model", async () => {
  const r = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: "does-not-exist",
      stream: false,
      messages: [{ role: "user", content: "hi" }],
    }),
  });
  expect(r.status).toBe(404);
  const j = await r.json();
  expect(j?.error?.code).toBe("model_not_found");
});

test("chat completions non-stream returns assistant text", async () => {
  const r = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: "codex-5",
      stream: false,
      messages: [{ role: "user", content: "Say hello" }],
    }),
  });
  expect(r.status).toBe(200);
  const j = await r.json();
  expect(j.object).toBe("chat.completion");
  const content = j?.choices?.[0]?.message?.content || "";
  expect(content.toLowerCase()).toContain("hello");
});

test("usage endpoints produce aggregates", async () => {
  // Trigger a couple of requests to populate usage file
  for (let i = 0; i < 2; i++) {
    await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: "codex-5",
        stream: false,
        messages: [{ role: "user", content: "Say hello again" }],
      }),
    });
  }
  // Give a brief moment for async file append
  await wait(200);
  const agg = await fetch(`${BASE}/usage?group=hour`).then((r) => r.json());
  expect(agg).toHaveProperty("total_requests");
  expect(agg).toHaveProperty("prompt_tokens_est");
  const raw = await fetch(`${BASE}/usage/raw?limit=5`).then((r) => r.json());
  expect(raw).toHaveProperty("count");
  expect(Array.isArray(raw.events)).toBe(true);
});
