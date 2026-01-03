import { test, expect, beforeAll, afterAll } from "vitest";
import fetch from "node-fetch";
import { spawnServer, stopServer } from "./helpers.js";

let PORT;
let child;

beforeAll(async () => {
  const server = await spawnServer({
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

test("HEAD /v1/chat/completions responds 200", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: "HEAD",
    headers: { Authorization: "Bearer test-sk-ci" },
  });
  expect(r.status).toBe(200);
});

test("OPTIONS /v1/chat/completions exposes CORS", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: "OPTIONS",
    headers: { Origin: "http://example.com", "Access-Control-Request-Method": "POST" },
  });
  expect([200, 204]).toContain(r.status);
  const acao = r.headers.get
    ? r.headers.get("access-control-allow-origin")
    : r.headers["access-control-allow-origin"];
  expect(acao).toBeTruthy();
});
