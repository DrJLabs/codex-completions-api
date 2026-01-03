import { beforeAll, afterAll, test, expect } from "vitest";
import fetch from "node-fetch";
import { spawnServer, stopServer } from "./helpers.js";

let PORT;
let child;

beforeAll(async () => {
  const server = await spawnServer({
    PROXY_API_KEY: "test-sk-ci",
    CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
    PROXY_PROTECT_MODELS: "false",
    PROXY_ENABLE_RESPONSES: "false",
  });
  PORT = server.PORT;
  child = server.child;
}, 10_000);

afterAll(async () => {
  await stopServer(child);
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
