import { afterEach, describe, expect, it } from "vitest";
import fetch from "node-fetch";
import { startServer, stopServer } from "./helpers.js";

describe("app-server non-stream idle timeout", () => {
  let child;

  afterEach(async () => {
    if (child) {
      await stopServer(child);
      child = undefined;
    }
  });

  it("uses PROXY_IDLE_TIMEOUT_MS for app-server requests", async () => {
    const started = await startServer({
      PROXY_USE_APP_SERVER: "true",
      CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
      CODEX_WORKER_SUPERVISED: "true",
      FAKE_CODEX_JSONRPC_HANG: "message",
      PROXY_IDLE_TIMEOUT_MS: "100",
      PROXY_TIMEOUT_MS: "10000",
      PROXY_API_KEY: "test-sk-ci",
    });
    child = started.child;

    const startedAt = Date.now();
    const response = await fetch(`http://127.0.0.1:${started.PORT}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-sk-ci",
      },
      body: JSON.stringify({
        model: "codex-5",
        stream: false,
        messages: [{ role: "user", content: "timeout please" }],
      }),
    });
    const elapsedMs = Date.now() - startedAt;

    expect(response.status).toBe(504);
    const payload = await response.json();
    expect(payload?.error?.code).toBe("idle_timeout");
    expect(elapsedMs).toBeLessThan(1500);
  }, 15000);
});
