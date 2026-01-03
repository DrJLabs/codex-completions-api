import { beforeAll, afterAll, test, expect } from "vitest";
import fetch from "node-fetch";
import { spawnServer } from "./helpers.js";

let PORT;
let child;

beforeAll(async () => {
  const server = await spawnServer({
    PROXY_API_KEY: "test-sk-ci",
    CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
    PROXY_USE_APP_SERVER: "false",
    PROXY_PROTECT_MODELS: "false",
  });
  PORT = server.PORT;
  child = server.child;
});

afterAll(async () => {
  if (child && !child.killed) {
    try {
      child.kill("SIGTERM");
    } catch {}
  }
});

test("GET /healthz returns ok + sandbox_mode", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/healthz`);
  expect(r.status).toBe(200);
  expect(r.headers.get("content-type")).toMatch(/application\/json/);
  const j = await r.json();
  expect(j).toHaveProperty("ok", false);
  expect(j).toHaveProperty("sandbox_mode");
  expect(j).toHaveProperty("health");
  expect(j.health).toHaveProperty("readiness");
  expect(j.health).toHaveProperty("liveness");
  expect(j.health.readiness).toMatchObject({ ready: false });
  expect(j.health.liveness).toMatchObject({ live: false });
});

test("GET /readyz reports failure when app server disabled", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/readyz`);
  expect(r.status).toBe(503);
  const j = await r.json();
  expect(j).toMatchObject({ ok: false, app_server_enabled: false });
  expect(j.health.readiness).toMatchObject({ ready: false, reason: "app_server_disabled" });
});

test("GET /livez reports failure when app server disabled", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/livez`);
  expect(r.status).toBe(503);
  const j = await r.json();
  expect(j).toMatchObject({ ok: false, app_server_enabled: false });
  expect(j.health.liveness).toMatchObject({ live: false, reason: "app_server_disabled" });
});
