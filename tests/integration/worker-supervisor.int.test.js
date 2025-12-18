import { beforeAll, afterAll, test, expect } from "vitest";
import getPort from "get-port";
import { spawn } from "node:child_process";
import fetch from "node-fetch";
import { wait, waitForUrlOk } from "./helpers.js";

let PORT;
let child;

const baseUrl = () => `http://127.0.0.1:${PORT}`;

async function fetchHealth() {
  const res = await fetch(`${baseUrl()}/healthz`);
  if (!res.ok) {
    throw new Error(`health response ${res.status}`);
  }
  return res.json();
}

async function waitForSupervisorReady(timeoutMs = 5000) {
  const start = Date.now();
  while (true) {
    const health = await fetchHealth();
    if (health?.worker_supervisor?.ready) return health;
    if (Date.now() - start > timeoutMs) {
      throw new Error("worker supervisor readiness timeout");
    }
    await wait(50);
  }
}

async function waitForRestart(previousCount, timeoutMs = 5000) {
  const start = Date.now();
  while (true) {
    const health = await fetchHealth();
    if (
      (health?.worker_supervisor?.restarts_total ?? 0) > previousCount &&
      health.worker_supervisor.ready
    ) {
      return health;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error("worker supervisor restart timeout");
    }
    await wait(50);
  }
}

beforeAll(async () => {
  PORT = await getPort();
  child = spawn("node", ["server.js"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      PROXY_API_KEY: "test-sk-ci",
      CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
      PROXY_PROTECT_MODELS: "false",
      PROXY_USE_APP_SERVER: "true",
      WORKER_BACKOFF_INITIAL_MS: "50",
      WORKER_BACKOFF_MAX_MS: "200",
      WORKER_SHUTDOWN_GRACE_MS: "250",
      FAKE_CODEX_WORKER_READY_DELAY_MS: "20",
      FAKE_CODEX_WORKER_HEARTBEAT_MS: "100",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  await waitForUrlOk(`${baseUrl()}/healthz`);
  await waitForSupervisorReady();
});

afterAll(async () => {
  if (child && !child.killed) {
    try {
      child.kill("SIGTERM");
    } catch {}
  }
});

test("worker supervisor reports readiness and metrics", async () => {
  const health = await fetchHealth();
  const ws = health.worker_supervisor;
  expect(ws.enabled).toBe(true);
  expect(ws.ready).toBe(true);
  expect(ws.running).toBe(true);
  expect(typeof ws.pid).toBe("number");
  expect(ws.restarts_total).toBe(0);
  expect(Number.isFinite(ws.startup_latency_ms)).toBe(true);
  expect(ws.metrics).toBeDefined();
  expect(ws.metrics.codex_worker_restarts_total).toBe(ws.restarts_total);
  expect(ws.metrics.codex_worker_latency_ms).toBe(ws.startup_latency_ms);
});

test("worker restarts with bounded backoff and exposes metrics", async () => {
  const before = await fetchHealth();
  const prevRestarts = before.worker_supervisor.restarts_total;
  const pid = before.worker_supervisor.pid;
  expect(pid).toBeGreaterThan(0);
  process.kill(pid, "SIGTERM");
  const after = await waitForRestart(prevRestarts);
  const ws = after.worker_supervisor;
  expect(ws.restarts_total).toBeGreaterThan(prevRestarts);
  expect(ws.ready).toBe(true);
  expect(ws.consecutive_failures).toBe(0);
  expect(ws.pid).not.toBe(pid);
});

test("worker stream logs are redacted and keep canonical fields", async () => {
  const logs = [];
  const capture = (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && parsed.component === "worker" && parsed.event === "worker_stream") {
          logs.push(parsed);
        }
      } catch {
        // ignore non-JSON lines
      }
    }
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);

  const before = await fetchHealth();
  const prevRestarts = before.worker_supervisor.restarts_total;
  process.kill(before.worker_supervisor.pid, "SIGTERM");
  await waitForRestart(prevRestarts);
  await wait(100);

  child.stdout.off("data", capture);
  child.stderr.off("data", capture);

  expect(logs.length).toBeGreaterThan(0);
  for (const entry of logs) {
    expect(entry.event).toBe("worker_stream");
    expect(entry.component).toBe("worker");
    expect(entry.stream).toBeDefined();
    expect(entry.message).toBeUndefined();
    expect(entry.level === "info" || entry.level === "warn").toBe(true);
    expect(entry.ts).toBeDefined();
    expect(entry).not.toHaveProperty("messages");
    expect(entry).not.toHaveProperty("payload");
    expect(entry).not.toHaveProperty("body");
  }
});

test("graceful shutdown drains worker within grace period", async () => {
  const started = Date.now();
  child.kill("SIGTERM");
  const exitCode = await new Promise((resolve, reject) => {
    child.once("exit", (code) => resolve(code));
    setTimeout(() => reject(new Error("server shutdown timeout")), 2000);
  });
  const elapsed = Date.now() - started;
  expect(exitCode).toBe(0);
  expect(elapsed).toBeLessThan(2000);
});
