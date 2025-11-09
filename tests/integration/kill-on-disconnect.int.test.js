/* eslint-disable security/detect-non-literal-fs-filename */
import { beforeAll, afterAll, test, expect } from "vitest";
import getPort from "get-port";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";

let PORT;
let child;
let PID_FILE;

beforeAll(async () => {
  PORT = await getPort();
  PID_FILE = path.join(process.cwd(), ".tmp-child-pid.txt");
  try {
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
  } catch {}
  child = spawn("node", ["server.js"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      PROXY_API_KEY: "test-sk-ci",
      CODEX_BIN: "scripts/fake-codex-proto-long.js",
      PROXY_PROTECT_MODELS: "false",
      PROXY_SSE_KEEPALIVE_MS: "0",
      PROXY_KILL_ON_DISCONNECT: "true",
      CHILD_PID_FILE: PID_FILE,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  // wait health
  const start = Date.now();
  while (Date.now() - start < 5000) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (r.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
});

afterAll(async () => {
  try {
    if (child && !child.killed) child.kill("SIGTERM");
  } catch {}
  try {
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
  } catch {}
});

test("disconnect aborts stream and kills child process", async () => {
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
  // Give proxy a moment to propagate SIGTERM
  await new Promise((r) => setTimeout(r, 1000));
  const pid = Number(readFileSync(PID_FILE, "utf8"));
  let alive = true;
  try {
    process.kill(pid, 0);
    alive = true;
  } catch {
    alive = false;
  }
  expect(alive).toBe(false);
});
