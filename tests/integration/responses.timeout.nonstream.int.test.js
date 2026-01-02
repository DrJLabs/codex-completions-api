import { beforeAll, afterAll, test, expect } from "vitest";
import getPort from "get-port";
import { spawn } from "node:child_process";
import fetch from "node-fetch";
import { waitForReady } from "./helpers.js";

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
      FAKE_CODEX_JSONRPC_HANG: "message",
      PROXY_PROTECT_MODELS: "false",
      PROXY_IDLE_TIMEOUT_MS: "100",
      PROXY_TIMEOUT_MS: "5000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const start = Date.now();
  while (Date.now() - start < 5000) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (r.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await waitForReady(PORT);
});

afterAll(async () => {
  try {
    if (child && !child.killed) child.kill("SIGTERM");
  } catch {}
});

test("non-stream responses inherit idle timeout", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/v1/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-sk-ci" },
    body: JSON.stringify({
      model: "codex-5",
      stream: false,
      input: "hi",
    }),
  });
  expect(res.status).toBe(504);
  const payload = await res.json();
  expect(payload?.error?.code).toBe("idle_timeout");
});
