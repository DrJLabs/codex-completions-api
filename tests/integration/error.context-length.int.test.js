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
      PROXY_MAX_PROMPT_TOKENS: "10",
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
}, 10_000);

afterAll(async () => {
  try {
    if (child && !child.killed) child.kill("SIGTERM");
  } catch {}
});

test("chat: tokens exceeded returns 403 tokens_exceeded_error", async () => {
  const long = "a".repeat(200); // ~50 tokens by naive estimator
  const r = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer test-sk-ci` },
    body: JSON.stringify({
      model: "codex-5",
      stream: false,
      messages: [{ role: "user", content: long }],
    }),
  });
  expect(r.status).toBe(403);
  const j = await r.json();
  expect(j?.error?.type).toBe("tokens_exceeded_error");
});
