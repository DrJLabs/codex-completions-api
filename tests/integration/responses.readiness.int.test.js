import { describe, beforeEach, afterEach, test, expect } from "vitest";
import getPort from "get-port";
import { spawn } from "node:child_process";
import fetch from "node-fetch";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForHealth = async (port, { timeoutMs = 5000, intervalMs = 50 } = {}) => {
  const started = Date.now();
  while (true) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (res.status === 200) return;
    } catch {}
    if (Date.now() - started > timeoutMs) {
      throw new Error("health check timeout");
    }
    await wait(intervalMs);
  }
};

const waitForReady = async (port, { timeoutMs = 5000, intervalMs = 50 } = {}) => {
  const started = Date.now();
  while (true) {
    const res = await fetch(`http://127.0.0.1:${port}/readyz`);
    if (res.status === 200) return;
    if (Date.now() - started > timeoutMs) {
      throw new Error("readyz timeout");
    }
    await wait(intervalMs);
  }
};

describe("responses readiness guard (app-server backend)", () => {
  let PORT;
  let child;

  const stopServer = async () => {
    if (!child || child.killed) return;
    await new Promise((resolve) => {
      child.once("exit", () => resolve());
      child.kill("SIGTERM");
      setTimeout(() => resolve(), 500);
    });
    child = undefined;
  };

  const startServer = async (envOverrides = {}) => {
    await stopServer();
    PORT = await getPort();
    child = spawn("node", ["server.js"], {
      env: {
        ...process.env,
        PORT: String(PORT),
        PROXY_API_KEY: "test-sk-ci",
        PROXY_USE_APP_SERVER: "true",
        PROXY_PROTECT_MODELS: "false",
        CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
        ...envOverrides,
      },
      stdio: "ignore",
    });
    await waitForHealth(PORT);
  };

  afterEach(async () => {
    await stopServer();
  });

  beforeEach(async () => {
    PORT = await getPort();
  });

  test("returns 503 backend_unavailable when worker is not ready", async () => {
    await startServer({ FAKE_CODEX_HANDSHAKE_MODE: "timeout" });

    const res = await fetch(`http://127.0.0.1:${PORT}/v1/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-sk-ci",
      },
      body: JSON.stringify({
        model: "codex-5",
        input: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      }),
    });

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body?.error?.type).toBe("backend_unavailable");
    expect(body?.error?.code).toBe("worker_not_ready");
    expect(body?.worker_status?.ready).toBe(false);
  });

  test("allows responses once worker is ready", async () => {
    await startServer();
    await waitForReady(PORT);

    const res = await fetch(`http://127.0.0.1:${PORT}/v1/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-sk-ci",
      },
      body: JSON.stringify({
        model: "codex-5",
        input: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body?.output).toBeInstanceOf(Array);
  });
});
