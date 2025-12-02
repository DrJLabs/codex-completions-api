import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import getPort from "get-port";
import fetch from "node-fetch";
import { stopServer, waitForUrlOk } from "./helpers.js";

async function startServerWithLogs(envOverrides = {}) {
  const PORT = await getPort();
  const binOverride = envOverrides.CODEX_BIN;
  const binLower = String(binOverride || "").toLowerCase();
  const inferredFlagFromBin = binOverride
    ? binLower.includes("jsonrpc") || binLower.includes("app-server")
      ? "true"
      : "false"
    : undefined;
  const desiredFlag = envOverrides.PROXY_USE_APP_SERVER;
  const resolvedFlag = desiredFlag
    ? String(desiredFlag).toLowerCase() === "true"
      ? "true"
      : "false"
    : inferredFlagFromBin || "true";
  const resolvedBin =
    binOverride ||
    (resolvedFlag === "true" ? "scripts/fake-codex-jsonrpc.js" : "scripts/fake-codex-proto.js");
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

  it("switches to proto mode when flag disabled", async () => {
    const started = await startServerWithLogs({
      PROXY_USE_APP_SERVER: "false",
      CODEX_BIN: "scripts/fake-codex-proto.js",
    });
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
    const stdoutLogs = started.stdout.join("");
    const stderrLogs = started.stderr.join("");
    expect(stdoutLogs).toContain(
      "[proxy][backend-mode] PROXY_USE_APP_SERVER=false -> defaulting to proto backend"
    );
    expect(chat.status).toBe(200);
    await chat.json();
    expect(stdoutLogs).toMatch(/spawning backend=proto/);
    expect(stderrLogs).not.toContain("worker not ready");
  });
});
