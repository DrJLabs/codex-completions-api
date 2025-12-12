import { describe, test, expect, beforeEach, afterEach } from "vitest";
import getPort from "get-port";
import { spawn } from "node:child_process";
import fetch from "node-fetch";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForHealth = async (port, { timeoutMs = 5000, intervalMs = 100 } = {}) => {
  const start = Date.now();
  while (true) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (r.ok) return;
    } catch {}
    if (Date.now() - start > timeoutMs) throw new Error("health timeout");
    await wait(intervalMs);
  }
};

describe("legacy /v1/completions auth and rate limits", () => {
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

  const startServer = async (env = {}) => {
    await stopServer();
    PORT = await getPort();
    child = spawn("node", ["server.js"], {
      env: {
        ...process.env,
        PORT: String(PORT),
        PROXY_API_KEY: "test-sk-ci",
        PROXY_PROTECT_MODELS: "false",
        CODEX_BIN: "scripts/fake-codex-proto.js",
        ...env,
      },
      stdio: "ignore",
    });
    await waitForHealth(PORT);
  };

  beforeEach(async () => {
    PORT = await getPort();
  });

  afterEach(async () => {
    await stopServer();
  });

  test("rejects missing bearer token", async () => {
    await startServer();

    const res = await fetch(`http://127.0.0.1:${PORT}/v1/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "codex-5", prompt: "hi", stream: false }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body?.error?.type).toBe("authentication_error");
  });

  test("enforces rate limit the same as chat", async () => {
    await startServer({
      PROXY_RATE_LIMIT_ENABLED: "true",
      PROXY_RATE_LIMIT_WINDOW_MS: "100000",
      PROXY_RATE_LIMIT_MAX: "1",
    });

    const common = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-sk-ci",
      },
    };

    const first = await fetch(`http://127.0.0.1:${PORT}/v1/completions`, {
      ...common,
      body: JSON.stringify({ model: "codex-5", prompt: "hi", stream: false }),
    });
    expect(first.status).toBe(200);

    const second = await fetch(`http://127.0.0.1:${PORT}/v1/completions`, {
      ...common,
      body: JSON.stringify({ model: "codex-5", prompt: "hi again", stream: false }),
    });
    expect(second.status).toBe(429);
    const body = await second.json();
    expect(body?.error?.code).toBe("rate_limited");
  });

  test("non-stream completions returns text_completion object", async () => {
    await startServer();

    const res = await fetch(`http://127.0.0.1:${PORT}/v1/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-sk-ci",
      },
      body: JSON.stringify({ model: "codex-5", prompt: "Say hi", stream: false }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body?.object).toBe("text_completion");
    expect(body?.choices?.[0]?.text).toBeTruthy();
  });
});
