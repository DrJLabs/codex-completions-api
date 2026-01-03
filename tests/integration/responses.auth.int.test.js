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

test("responses route requires bearer token", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/v1/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "codex-5", input: "hi" }),
  });
  expect(r.status).toBe(401);
  expect(r.headers.get("www-authenticate")).toMatch(/Bearer/);
  const j = await r.json();
  expect(j?.error?.type).toBe("authentication_error");
});
