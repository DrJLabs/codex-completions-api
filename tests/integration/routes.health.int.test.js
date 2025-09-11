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
});
