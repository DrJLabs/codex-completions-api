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
