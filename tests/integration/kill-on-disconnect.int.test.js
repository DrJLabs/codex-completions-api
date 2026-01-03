/* eslint-disable security/detect-non-literal-fs-filename */
import { beforeAll, afterAll, test, expect } from "vitest";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer, stopServer } from "./helpers.js";

let PORT;
let child;
let PID_FILE;
let tempDir;

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "kill-disconnect-"));
  PID_FILE = path.join(tempDir, "child.pid");
  try {
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
  } catch {}
  const server = await startServer({
    PROXY_API_KEY: "test-sk-ci",
    CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
    FAKE_CODEX_MODE: "long_stream",
    PROXY_PROTECT_MODELS: "false",
    PROXY_SSE_KEEPALIVE_MS: "0",
    PROXY_KILL_ON_DISCONNECT: "true",
    CHILD_PID_FILE: PID_FILE,
  });
  PORT = server.PORT;
  child = server.child;
});

afterAll(async () => {
  await stopServer(child);
  try {
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
  } catch {}
  if (tempDir) {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {}
  }
});

test("disconnect aborts stream without killing worker process", async () => {
  const controller = new AbortController();
  const res = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer test-sk-ci` },
    body: JSON.stringify({
      model: "codex-5",
      stream: true,
      messages: [{ role: "user", content: "hi" }],
    }),
    signal: controller.signal,
  });
  expect(res.ok).toBeTruthy();
  const reader = res.body.getReader();
  // Wait until the shim writes its PID file
  {
    const start = Date.now();
    while (!existsSync(PID_FILE) && Date.now() - start < 3000) {
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  // Read a single chunk then abort
  await reader.read();
  controller.abort();
  // Give proxy a moment to propagate cancellation
  await new Promise((r) => setTimeout(r, 1000));
  const pid = Number(readFileSync(PID_FILE, "utf8"));
  let alive = true;
  try {
    process.kill(pid, 0);
    alive = true;
  } catch {
    alive = false;
  }
  expect(alive).toBe(true);
  const ready = await fetch(`http://127.0.0.1:${PORT}/readyz`);
  expect(ready.ok).toBe(true);
});
