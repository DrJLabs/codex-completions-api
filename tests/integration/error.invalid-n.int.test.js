import { beforeAll, afterAll, test, expect } from "vitest";
import fetch from "node-fetch";
import { startServer, stopServer } from "./helpers.js";

let PORT;
let child;

beforeAll(async () => {
  const server = await startServer({
    PROXY_API_KEY: "test-sk-ci",
    CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
    PROXY_PROTECT_MODELS: "false",
  });
  PORT = server.PORT;
  child = server.child;
}, 10_000);

afterAll(async () => {
  await stopServer(child);
});

test("chat: n=0 returns 400 invalid_request_error with param n", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer test-sk-ci` },
    body: JSON.stringify({
      model: "codex-5",
      stream: false,
      n: 0,
      messages: [{ role: "user", content: "hi" }],
    }),
  });
  expect(r.status).toBe(400);
  const j = await r.json();
  expect(j?.error?.type).toBe("invalid_request_error");
  expect(j?.error?.param).toBe("n");
});

test("chat: n greater than allowed maximum returns 400 invalid_request_error", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer test-sk-ci` },
    body: JSON.stringify({
      model: "codex-5",
      stream: false,
      n: 6,
      messages: [{ role: "user", content: "hi" }],
    }),
  });
  expect(r.status).toBe(400);
  const j = await r.json();
  expect(j?.error?.type).toBe("invalid_request_error");
  expect(j?.error?.param).toBe("n");
});
