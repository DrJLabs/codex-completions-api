import { beforeAll, afterAll, test, expect } from "vitest";
import getPort from "get-port";
import { spawn } from "node:child_process";
import fetch from "node-fetch";
import { waitForReady } from "./helpers.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForLog(logs, matcher, { timeoutMs = 5000, intervalMs = 50 } = {}) {
  const start = Date.now();
  const pattern = matcher instanceof RegExp ? matcher : null;
  const needle = pattern ? null : String(matcher);
  while (Date.now() - start < timeoutMs) {
    const content = logs.join("");
    if (pattern ? pattern.test(content) : content.includes(needle)) return;
    await wait(intervalMs);
  }
  throw new Error(`log timeout: ${matcher}`);
}

let PORT;
let BASE;
let child;

beforeAll(async () => {
  PORT = await getPort();
  BASE = `http://127.0.0.1:${PORT}/v1`;
  child = spawn("node", ["server.js"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      PROXY_API_KEY: "test-sk-ci",
      CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
      PROXY_PROTECT_MODELS: "false",
      PROXY_RATE_LIMIT_ENABLED: "true",
      PROXY_RATE_LIMIT_WINDOW_MS: "5000",
      PROXY_RATE_LIMIT_MAX: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  const stdout = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  await waitForLog(stdout, `:${PORT}/v1`);
  await waitForReady(PORT);
}, 10_000);

afterAll(async () => {
  try {
    if (child && !child.killed) child.kill("SIGTERM");
  } catch {}
});

test("rate limit returns 429 rate_limit_error", async () => {
  // First request ok
  const r1 = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer test-sk-ci` },
    body: JSON.stringify({
      model: "codex-5",
      stream: false,
      messages: [{ role: "user", content: "hi" }],
    }),
  });
  expect(r1.status).toBe(200);
  // Second within window should be rate limited
  const r2 = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer test-sk-ci` },
    body: JSON.stringify({
      model: "codex-5",
      stream: false,
      messages: [{ role: "user", content: "hi again" }],
    }),
  });
  expect(r2.status).toBe(429);
  const j = await r2.json();
  expect(j?.error?.type).toBe("rate_limit_error");
});
