import { afterEach, describe, expect, it } from "vitest";
import fetch from "node-fetch";
import { startServer, stopServer } from "./helpers.js";

describe("json-rpc transport", () => {
  let child;

  afterEach(async () => {
    if (child) {
      await stopServer(child);
      child = undefined;
    }
  });

  it("handles non-stream chat completions over JSON-RPC", async () => {
    const started = await startServer({
      PROXY_USE_APP_SERVER: "true",
      CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
      CODEX_WORKER_SUPERVISED: "true",
      PROXY_API_KEY: "test-sk-ci",
    });
    child = started.child;

    const health = await fetch(`http://127.0.0.1:${started.PORT}/healthz`);
    expect(health.status).toBe(200);
    const healthBody = await health.json();
    expect(healthBody.app_server_enabled).toBe(true);

    let response;
    const payload = {
      model: "codex-5",
      stream: false,
      messages: [{ role: "user", content: "Test message" }],
    };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      response = await fetch(`http://127.0.0.1:${started.PORT}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-sk-ci",
        },
        body: JSON.stringify(payload),
      });
      if (response.status === 200) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.choices)).toBe(true);
    expect(body.choices[0]?.message?.content || "").toContain("Hello from fake-codex.");
    expect(body.choices[0]?.finish_reason).toBe("stop");
    expect(body.usage?.prompt_tokens).toBeDefined();
    expect(body.usage?.completion_tokens).toBeDefined();
  }, 15000);

  it("returns retryable timeout when worker stalls", async () => {
    const started = await startServer({
      PROXY_USE_APP_SERVER: "true",
      CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
      CODEX_WORKER_SUPERVISED: "true",
      WORKER_REQUEST_TIMEOUT_MS: "200",
      FAKE_CODEX_JSONRPC_HANG: "message",
      PROXY_API_KEY: "test-sk-ci",
    });
    child = started.child;

    let response;
    const bodyPayload = {
      model: "codex-5",
      stream: false,
      messages: [{ role: "user", content: "Timeout please" }],
    };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      response = await fetch(`http://127.0.0.1:${started.PORT}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-sk-ci",
        },
        body: JSON.stringify(bodyPayload),
      });
      if (response.status !== 503) break;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    expect(response.status).toBe(504);
    const body = await response.json();
    expect(body?.error?.code).toBe("worker_request_timeout");
    expect(body?.error?.retryable).toBe(true);
  }, 15000);

  it("returns auth error when app-server signals unauthorized", async () => {
    const started = await startServer({
      PROXY_USE_APP_SERVER: "true",
      CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
      CODEX_WORKER_SUPERVISED: "true",
      FAKE_CODEX_UNAUTHORIZED: "1",
      PROXY_API_KEY: "test-sk-ci",
    });
    child = started.child;

    const response = await fetch(`http://127.0.0.1:${started.PORT}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-sk-ci",
      },
      body: JSON.stringify({
        model: "codex-5",
        stream: false,
        messages: [{ role: "user", content: "Auth please" }],
      }),
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toMatchObject({
      error: {
        message: "unauthorized",
        type: "authentication_error",
        code: "invalid_api_key",
      },
    });
    expect(body.error).not.toHaveProperty("retryable");
  }, 15000);
});
