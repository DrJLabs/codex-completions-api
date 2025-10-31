import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import getPort from "get-port";
import fetch from "node-fetch";
import { stopServer, waitForUrlOk } from "./helpers.js";

async function startServerWithLogs(envOverrides = {}) {
  const PORT = await getPort();
  const child = spawn("node", ["server.js"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      PROXY_API_KEY: envOverrides.PROXY_API_KEY || "test-sk-ci",
      CODEX_BIN: envOverrides.CODEX_BIN || "scripts/fake-codex-proto.js",
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

  it("defaults to proto and logs selection when flag is unset", async () => {
    const started = await startServerWithLogs();
    child = started.child;
    const response = await fetch(`http://127.0.0.1:${started.PORT}/healthz`);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.backend_mode).toBe("proto");
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
    expect(chat.status).toBe(200);
    await chat.json();

    const logs = started.stdout.join("");
    expect(logs).toContain(
      "[proxy][backend-mode] PROXY_USE_APP_SERVER=false -> defaulting to proto backend"
    );
    expect(logs).toMatch(/spawning backend=proto/);
  });

  it("switches to app-server mode and logs when flag enabled", async () => {
    const started = await startServerWithLogs({
      PROXY_USE_APP_SERVER: "true",
      CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
      CODEX_WORKER_SUPERVISED: "true",
    });
    child = started.child;
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
    const stdoutLogs = started.stdout.join("");
    const stderrLogs = started.stderr.join("");
    expect(stdoutLogs).toContain(
      "[proxy][backend-mode] PROXY_USE_APP_SERVER=true -> activating app-server backend"
    );
    if (chat.status === 503) {
      const chatBody = await chat.json();
      expect(chatBody?.error?.code).toBe("worker_not_ready");
      expect(stderrLogs).toContain(
        "[proxy][worker-supervisor] worker not ready; returning 503 backend_unavailable"
      );
    } else {
      expect(chat.status).toBe(200);
      await chat.json();
      expect(stdoutLogs).toMatch(/spawning backend=app-server/);
    }
  });
});
