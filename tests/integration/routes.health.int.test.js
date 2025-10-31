import { beforeAll, afterAll, test, expect } from "vitest";
import getPort from "get-port";
import { spawn } from "node:child_process";
import fetch from "node-fetch";
import { waitForUrlOk } from "./helpers.js";

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
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  await waitForUrlOk(`http://127.0.0.1:${PORT}/healthz`);
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
  expect(j).toHaveProperty("ok", true);
  expect(j).toHaveProperty("sandbox_mode");
  expect(j).toHaveProperty("readiness");
  expect(j).toHaveProperty("liveness");
  expect(j.readiness).toMatchObject({ ready: true });
  expect(j.liveness).toMatchObject({ live: true });
});

test("GET /readyz reports success when app server disabled", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/readyz`);
  expect(r.status).toBe(200);
  const j = await r.json();
  expect(j).toMatchObject({ ok: true, app_server_enabled: false });
  expect(j.readiness).toMatchObject({ ready: true, reason: "app_server_disabled" });
});

test("GET /livez reports success when app server disabled", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/livez`);
  expect(r.status).toBe(200);
  const j = await r.json();
  expect(j).toMatchObject({ ok: true, app_server_enabled: false });
  expect(j.liveness).toMatchObject({ live: true, reason: "app_server_disabled" });
});
