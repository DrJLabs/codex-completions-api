import { describe, beforeAll, afterAll, test, expect } from "vitest";
import { startServer, stopServer } from "./helpers.js";
import {
  ensureTranscripts,
  loadTranscript,
  sanitizeNonStreamResponse,
} from "../shared/transcript-utils.js";

describe("chat completion non-stream contract", () => {
  let serverCtx;
  let transcript;
  const APP_SERVER_ENV = {
    CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
    PROXY_USE_APP_SERVER: "true",
    CODEX_WORKER_SUPERVISED: "true",
  };

  beforeAll(async () => {
    ensureTranscripts(["nonstream-minimal.json"]);
    transcript = await loadTranscript("nonstream-minimal.json");
    serverCtx = await startServer(APP_SERVER_ENV);
  }, 10_000);

  afterAll(async () => {
    if (serverCtx) await stopServer(serverCtx.child);
  });

  test("minimal non-stream response matches golden transcript", async () => {
    const { request, response: expected } = transcript;

    const res = await fetch(`http://127.0.0.1:${serverCtx.PORT}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-sk-ci",
      },
      body: JSON.stringify(request),
    });

    expect(res.ok).toBe(true);
    const payload = await res.json();
    const sanitized = sanitizeNonStreamResponse(payload);
    expect(sanitized).toEqual(expected);
  });

  test("truncation path matches golden transcript", async () => {
    ensureTranscripts(["nonstream-truncation.json"]);
    const truncation = await loadTranscript("nonstream-truncation.json");
    const ctx = await startServer({
      ...APP_SERVER_ENV,
      FAKE_CODEX_MODE: "truncation",
    });
    try {
      const res = await fetch(`http://127.0.0.1:${ctx.PORT}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-sk-ci",
        },
        body: JSON.stringify(truncation.request),
      });
      expect(res.ok).toBe(true);
      const payload = await res.json();
      const sanitized = sanitizeNonStreamResponse(payload);
      expect(sanitized).toEqual(truncation.response);
    } finally {
      await stopServer(ctx.child);
    }
  });

  test("openai-json override keeps tool-call content null", async () => {
    ensureTranscripts(["nonstream-tool-calls.json"]);
    const toolCall = await loadTranscript("nonstream-tool-calls.json");
    const ctx = await startServer({
      ...APP_SERVER_ENV,
      FAKE_CODEX_MODE: "tool_call",
    });
    try {
      const res = await fetch(`http://127.0.0.1:${ctx.PORT}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-sk-ci",
          "x-proxy-output-mode": "openai-json",
        },
        body: JSON.stringify(toolCall.request),
      });
      expect(res.ok).toBe(true);
      const payload = await res.json();
      expect(payload?.choices?.[0]?.message?.content).toBeNull();
      expect(payload?.choices?.[0]?.message?.tool_calls).toBeTruthy();
    } finally {
      await stopServer(ctx.child);
    }
  });
});
