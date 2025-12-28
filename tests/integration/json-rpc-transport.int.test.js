import { afterEach, describe, expect, it } from "vitest";
import fetch from "node-fetch";
import { startServer, stopServer } from "./helpers.js";
import { parseSSE } from "../shared/transcript-utils.js";

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

  it("includes auth login details when login URL flag is enabled", async () => {
    const authUrl = "https://example.com/fake-login?source=test";
    const loginId = "login-test-123";
    const started = await startServer({
      PROXY_USE_APP_SERVER: "true",
      CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
      CODEX_WORKER_SUPERVISED: "true",
      FAKE_CODEX_UNAUTHORIZED: "1",
      FAKE_CODEX_AUTH_URL: authUrl,
      FAKE_CODEX_LOGIN_ID: loginId,
      PROXY_AUTH_LOGIN_URL: "true",
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
        messages: [{ role: "user", content: "Auth details please" }],
      }),
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error?.details).toMatchObject({
      auth_url: authUrl,
      login_id: loginId,
    });
  }, 15000);

  it("embeds login URL in error code when auth login mode is code", async () => {
    const authUrl = "https://example.com/fake-login?source=code";
    const loginId = "login-code-123";
    const started = await startServer({
      PROXY_USE_APP_SERVER: "true",
      CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
      CODEX_WORKER_SUPERVISED: "true",
      FAKE_CODEX_UNAUTHORIZED: "1",
      FAKE_CODEX_AUTH_URL: authUrl,
      FAKE_CODEX_LOGIN_ID: loginId,
      PROXY_AUTH_LOGIN_URL: "true",
      PROXY_AUTH_LOGIN_URL_MODE: "code",
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
        messages: [{ role: "user", content: "Auth code please" }],
      }),
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error?.code).toContain(`login_url=${authUrl}`);
    expect(body.error?.code).toContain(`login_id=${loginId}`);
  }, 15000);

  it("streams auth error with login details when login URL flag is enabled", async () => {
    const authUrl = "https://example.com/fake-login?source=stream";
    const loginId = "login-stream-123";
    const started = await startServer({
      PROXY_USE_APP_SERVER: "true",
      CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
      CODEX_WORKER_SUPERVISED: "true",
      FAKE_CODEX_UNAUTHORIZED: "1",
      FAKE_CODEX_AUTH_URL: authUrl,
      FAKE_CODEX_LOGIN_ID: loginId,
      PROXY_AUTH_LOGIN_URL: "true",
      PROXY_SSE_KEEPALIVE_MS: "0",
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
        stream: true,
        messages: [{ role: "user", content: "Auth details stream" }],
      }),
    });

    expect(response.status).toBe(200);
    const raw = await response.text();
    const entries = parseSSE(raw);
    const errorEntry = entries.find((entry) => entry?.type === "data" && entry?.data?.error);
    expect(errorEntry?.data?.error?.details).toMatchObject({
      auth_url: authUrl,
      login_id: loginId,
    });
  }, 15000);

  it("streams auth error with login URL embedded in code when mode is code", async () => {
    const authUrl = "https://example.com/fake-login?source=stream-code";
    const loginId = "login-stream-code-123";
    const started = await startServer({
      PROXY_USE_APP_SERVER: "true",
      CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
      CODEX_WORKER_SUPERVISED: "true",
      FAKE_CODEX_UNAUTHORIZED: "1",
      FAKE_CODEX_AUTH_URL: authUrl,
      FAKE_CODEX_LOGIN_ID: loginId,
      PROXY_AUTH_LOGIN_URL: "true",
      PROXY_AUTH_LOGIN_URL_MODE: "code",
      PROXY_SSE_KEEPALIVE_MS: "0",
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
        stream: true,
        messages: [{ role: "user", content: "Auth code stream" }],
      }),
    });

    expect(response.status).toBe(200);
    const raw = await response.text();
    const entries = parseSSE(raw);
    const errorEntry = entries.find((entry) => entry?.type === "data" && entry?.data?.error);
    expect(errorEntry?.data?.error?.code).toContain(`login_url=${authUrl}`);
    expect(errorEntry?.data?.error?.code).toContain(`login_id=${loginId}`);
  }, 15000);

  it("streams auth error with login URL embedded in message when mode is code+message", async () => {
    const authUrl = "https://example.com/fake-login?source=stream-message";
    const loginId = "login-stream-message-123";
    const started = await startServer({
      PROXY_USE_APP_SERVER: "true",
      CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
      CODEX_WORKER_SUPERVISED: "true",
      FAKE_CODEX_UNAUTHORIZED: "1",
      FAKE_CODEX_AUTH_URL: authUrl,
      FAKE_CODEX_LOGIN_ID: loginId,
      PROXY_AUTH_LOGIN_URL: "true",
      PROXY_AUTH_LOGIN_URL_MODE: "code+message",
      PROXY_SSE_KEEPALIVE_MS: "0",
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
        stream: true,
        messages: [{ role: "user", content: "Auth message stream" }],
      }),
    });

    expect(response.status).toBe(200);
    const raw = await response.text();
    const entries = parseSSE(raw);
    const errorEntry = entries.find((entry) => entry?.type === "data" && entry?.data?.error);
    expect(errorEntry?.data?.error?.message).toContain(`login_url=${authUrl}`);
    expect(errorEntry?.data?.error?.message).toContain(`login_id=${loginId}`);
  }, 15000);
});
