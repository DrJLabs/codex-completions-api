import { beforeAll, afterAll, test, expect } from "vitest";
import fetch from "node-fetch";
import { startServer, stopServer } from "./helpers.js";

let PORT;
let child;

beforeAll(async () => {
  const server = await startServer({
    PROXY_API_KEY: "test-sk-ci",
    CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
    FAKE_CODEX_JSONRPC_HANG: "message",
    PROXY_PROTECT_MODELS: "false",
    PROXY_IDLE_TIMEOUT_MS: "100",
    PROXY_TIMEOUT_MS: "5000",
  });
  PORT = server.PORT;
  child = server.child;
});

afterAll(async () => {
  await stopServer(child);
});

test("non-stream idle triggers 504 timeout_error", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer test-sk-ci` },
    body: JSON.stringify({
      model: "codex-5",
      stream: false,
      messages: [{ role: "user", content: "hi" }],
    }),
  });
  expect(r.status).toBe(504);
  const j = await r.json();
  expect(j?.error?.code).toBe("idle_timeout");
});
