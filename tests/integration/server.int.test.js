// Integration tests for Express API using a real child server
// Spawns server.js on a random port with a deterministic proto shim

import { beforeAll, afterAll, test, expect } from "vitest";
import getPort from "get-port";
import { spawn } from "node:child_process";
import { unlinkSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import fetch from "node-fetch";

let PORT;
let BASE;
let API_KEY = "test-sk-ci";
let child;
let TOKEN_FILE;
let PROTO_FILE;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const readJsonLines = async (filePath) => {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper reads temp files
    const content = await readFile(filePath, "utf8");
    return content
      .split(/\n+/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    throw err;
  }
};

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
  PROTO_FILE = path.join(process.cwd(), ".tmp-proto-tracing.ndjson");
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- test temp file path under cwd
    if (existsSync(TOKEN_FILE)) unlinkSync(TOKEN_FILE);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- test temp file path under cwd
    if (existsSync(PROTO_FILE)) unlinkSync(PROTO_FILE);
  } catch {}
  child = spawn("node", ["server.js"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      PROXY_API_KEY: API_KEY,
      CODEX_BIN: "scripts/fake-codex-proto.js",
      PROXY_PROTECT_MODELS: "false",
      TOKEN_LOG_PATH: TOKEN_FILE,
      PROTO_LOG_PATH: PROTO_FILE,
      PROXY_ENV: "dev",
      PROXY_LOG_PROTO: "true",
      PROXY_TRACE_REQUIRED: "true",
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

test("models include environment base model", async () => {
  const r = await fetch(`${BASE}/models`);
  expect(r.status).toBe(200);
  const j = await r.json();
  const ids = (j.data || []).map((m) => m.id);
  const hasExpectedModel = ids.includes("codex-5") || ids.includes("codev-5");
  expect(hasExpectedModel).toBe(true);
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
  const agg = await fetch(`${BASE}/usage?group=hour`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  }).then((r) => r.json());
  expect(agg).toHaveProperty("total_requests");
  expect(agg).toHaveProperty("prompt_tokens_est");
  const raw = await fetch(`${BASE}/usage/raw?limit=5`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  }).then((r) => r.json());
  expect(raw).toHaveProperty("count");
  expect(Array.isArray(raw.events)).toBe(true);
});

test("usage raw entries expose tracing metadata", async () => {
  const response = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: "codex-5",
      stream: false,
      messages: [{ role: "user", content: "trace usage" }],
    }),
  });
  expect(response.status).toBe(200);
  const reqId = response.headers.get("x-request-id");
  expect(reqId).toBeTruthy();
  await response.json();

  await wait(200);
  const raw = await fetch(`${BASE}/usage/raw?limit=10`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  }).then((r) => r.json());
  const entry = raw.events.find((event) => event.req_id === reqId);
  expect(entry).toBeTruthy();
  expect(entry.phase).toBe("usage_summary");
  expect(entry.route).toBe("/v1/chat/completions");
  expect(entry.method).toBe("POST");
  expect(entry.mode).toBe("chat_nonstream");
  expect(entry.status_code).toBe(200);

  const protoEvents = await readJsonLines(PROTO_FILE);
  const matchingProto = protoEvents.find((event) => event.req_id === reqId);
  expect(matchingProto).toBeTruthy();
});
