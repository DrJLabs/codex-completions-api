import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import getPort from "get-port";
import fetch from "node-fetch";
import { stopServer, waitForUrlOk } from "./helpers.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForLog(logs, matcher, { timeoutMs = 5000, intervalMs = 50 } = {}) {
  const start = Date.now();
  const pattern = matcher instanceof RegExp ? matcher : null;
  const needle = pattern ? null : String(matcher);
  while (Date.now() - start < timeoutMs) {
    const content = logs.join("");
    if (pattern ? pattern.test(content) : content.includes(needle)) return;
    await wait(intervalMs);
  }
  throw new Error(`log timeout: ${matcher}`);
}

async function startServerWithLogs(envOverrides = {}) {
  const PORT = await getPort();
  const desiredFlag = envOverrides.PROXY_USE_APP_SERVER;
  const resolvedFlag =
    desiredFlag !== undefined
      ? String(desiredFlag).toLowerCase() === "true"
        ? "true"
        : "false"
      : "true";
  const resolvedBin = envOverrides.CODEX_BIN || "scripts/fake-codex-jsonrpc.js";
  const resolvedSupervisor =
    envOverrides.CODEX_WORKER_SUPERVISED || (resolvedFlag === "true" ? "true" : undefined);
  const child = spawn("node", ["server.js"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      PROXY_API_KEY: envOverrides.PROXY_API_KEY || "test-sk-ci",
      CODEX_BIN: resolvedBin,
      PROXY_USE_APP_SERVER: resolvedFlag,
      ...(resolvedSupervisor ? { CODEX_WORKER_SUPERVISED: resolvedSupervisor } : {}),
      PROXY_PROTECT_MODELS: envOverrides.PROXY_PROTECT_MODELS || "false",
      ...envOverrides,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  await waitForLog(stdout, `:${PORT}/v1`);
  await waitForUrlOk(`http://127.0.0.1:${PORT}/healthz`);
  return { PORT, child, stdout, stderr };
}

describe("backend mode feature flag", () => {
  let child;

  afterEach(async () => {
    if (child) {
      await stopServer(child);
      child = undefined;
    }
  });

  it("defaults to app-server and logs selection when flag is unset", async () => {
    const started = await startServerWithLogs();
    child = started.child;
    await waitForUrlOk(`http://127.0.0.1:${started.PORT}/readyz`);
    const response = await fetch(`http://127.0.0.1:${started.PORT}/healthz`);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.backend_mode).toBe("app-server");
    expect(payload.app_server_enabled).toBe(true);
    const chat = await fetch(`http://127.0.0.1:${started.PORT}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-sk-ci",
      },
      body: JSON.stringify({
        model: "codex-5",
        stream: false,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    expect(chat.status).toBe(200);
    await chat.json();

    const logs = started.stdout.join("");
    expect(logs).toContain(
      "[proxy][backend-mode] PROXY_USE_APP_SERVER=true -> activating app-server backend"
    );
    expect(logs).toMatch(/spawning backend=app-server/);
  });

  it("disables app-server when flag disabled", async () => {
    const started = await startServerWithLogs({
      PROXY_USE_APP_SERVER: "false",
    });
    child = started.child;
    const response = await fetch(`http://127.0.0.1:${started.PORT}/healthz`);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.backend_mode).toBe("disabled");
    expect(payload.app_server_enabled).toBe(false);
    const chat = await fetch(`http://127.0.0.1:${started.PORT}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-sk-ci",
      },
      body: JSON.stringify({
        model: "codex-5",
        stream: false,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    const stdoutLogs = started.stdout.join("");
    const stderrLogs = started.stderr.join("");
    expect(stdoutLogs).toContain(
      "[proxy][backend-mode] PROXY_USE_APP_SERVER=false -> app-server disabled (proto deprecated)"
    );
    expect(chat.status).toBe(503);
    await chat.json();
    expect(stdoutLogs).not.toMatch(/spawning backend=/);
    expect(stderrLogs).not.toContain("worker not ready");
  });
});
