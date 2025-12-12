import { beforeAll, afterAll, test, expect } from "vitest";
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
      CODEX_BIN: "scripts/fake-codex-proto.js",
      PROXY_PROTECT_MODELS: "false",
      PROXY_ENABLE_RESPONSES: "false",
    },
    stdio: "ignore",
  });
  const start = Date.now();
  while (Date.now() - start < 5000) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (r.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}, 10_000);

afterAll(async () => {
  try {
    if (child && !child.killed) child.kill("SIGTERM");
  } catch {}
});

test("responses route can be disabled via flag", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/v1/responses`, {
    method: "POST",
    headers: {
      Authorization: "Bearer test-sk-ci",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "codex-5", input: "hi" }),
  });
  expect(r.status).toBe(404);
});

test("HEAD responds 404 when responses are disabled", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/v1/responses`, {
    method: "HEAD",
    headers: {
      Authorization: "Bearer test-sk-ci",
    },
  });
  expect(r.status).toBe(404);
});
