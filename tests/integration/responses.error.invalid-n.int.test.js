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

test("responses: n=0 returns invalid_request_error matching chat parity", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/v1/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-sk-ci" },
    body: JSON.stringify({
      model: "codex-5",
      n: 0,
      input: "hello",
    }),
  });
  expect(r.status).toBe(400);
  const j = await r.json();
  expect(j?.error?.type).toBe("invalid_request_error");
  expect(j?.error?.param).toBe("n");
});

test("responses: n greater than max returns invalid_request_error", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/v1/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-sk-ci" },
    body: JSON.stringify({
      model: "codex-5",
      n: 6,
      input: "hello",
    }),
  });
  expect(r.status).toBe(400);
  const j = await r.json();
  expect(j?.error?.type).toBe("invalid_request_error");
  expect(j?.error?.param).toBe("n");
});
