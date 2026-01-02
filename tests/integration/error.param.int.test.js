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
    await new Promise((r) => setTimeout(r, 100));
  }
  await waitForReady(PORT);
}, 10_000);

afterAll(async () => {
  if (child && !child.killed) {
    try {
      child.kill("SIGTERM");
    } catch {}
  }
});

test("chat: missing messages returns 400 with error.param", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer test-sk-ci` },
    body: JSON.stringify({ model: "codex-5", stream: false, messages: [] }),
  });
  expect(r.status).toBe(400);
  const j = await r.json();
  expect(j?.error?.type).toBe("invalid_request_error");
  expect(j?.error?.param).toBe("messages");
});
