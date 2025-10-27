import { describe, beforeAll, afterAll, test, expect } from "vitest";
import { startServer, stopServer } from "./helpers.js";
import {
  ensureResponsesTranscripts,
  loadResponsesTranscript,
  sanitizeResponsesNonStream,
} from "../shared/transcript-utils.js";

describe("responses non-stream contract", () => {
  let serverCtx;
  let minimalTranscript;
  let toolCallTranscript;
  let chainedTranscript;

  beforeAll(async () => {
    ensureResponsesTranscripts();
    minimalTranscript = await loadResponsesTranscript("nonstream-minimal.json");
    toolCallTranscript = await loadResponsesTranscript("nonstream-tool-call.json");
    chainedTranscript = await loadResponsesTranscript("nonstream-previous-response.json");
    serverCtx = await startServer({ CODEX_BIN: "scripts/fake-codex-proto.js" });
  }, 10_000);

  afterAll(async () => {
    if (serverCtx) await stopServer(serverCtx.child);
  });

  test("minimal response matches transcript", async () => {
    const { request, response: expected } = minimalTranscript;
    const res = await fetch(`http://127.0.0.1:${serverCtx.PORT}/v1/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-sk-ci",
      },
      body: JSON.stringify(request),
    });
    expect(res.ok).toBe(true);
    const payload = await res.json();
    const sanitized = sanitizeResponsesNonStream(payload);
    expect(sanitized).toEqual(expected);
  });

  test("tool-call response matches transcript", async () => {
    const { request, response: expected } = toolCallTranscript;
    const toolServer = await startServer({
      CODEX_BIN: "scripts/fake-codex-proto.js",
      FAKE_CODEX_MODE: "tool_call",
    });
    try {
      const res = await fetch(`http://127.0.0.1:${toolServer.PORT}/v1/responses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-sk-ci",
        },
        body: JSON.stringify(request),
      });
      expect(res.ok).toBe(true);
      const payload = await res.json();
      const sanitized = sanitizeResponsesNonStream(payload);
      expect(sanitized).toEqual(expected);
    } finally {
      await stopServer(toolServer.child);
    }
  });

  test("previous_response_id is preserved and sanitized", async () => {
    const { request, response: expected } = chainedTranscript;
    const res = await fetch(`http://127.0.0.1:${serverCtx.PORT}/v1/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-sk-ci",
      },
      body: JSON.stringify(request),
    });
    expect(res.ok).toBe(true);
    const payload = await res.json();
    const sanitized = sanitizeResponsesNonStream(payload);
    expect(sanitized).toEqual(expected);
  });
});
