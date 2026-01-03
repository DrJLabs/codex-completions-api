import { beforeAll, afterAll, test, expect } from "vitest";
import fetch from "node-fetch";
import { startServer, stopServer } from "./helpers.js";

let PORT;
let BASE;
let child;

beforeAll(async () => {
  const server = await startServer({
    PROXY_API_KEY: "test-sk-ci",
    CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
    PROXY_PROTECT_MODELS: "false",
    PROXY_RATE_LIMIT_ENABLED: "true",
    PROXY_RATE_LIMIT_WINDOW_MS: "5000",
    PROXY_RATE_LIMIT_MAX: "1",
  });
  PORT = server.PORT;
  BASE = `http://127.0.0.1:${PORT}/v1`;
  child = server.child;
}, 10_000);

afterAll(async () => {
  await stopServer(child);
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
