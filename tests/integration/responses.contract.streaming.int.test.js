import { describe, beforeAll, afterAll, test, expect } from "vitest";
import { startServer, stopServer } from "./helpers.js";
import {
  ensureResponsesTranscripts,
  loadResponsesTranscript,
  parseSSE,
  sanitizeResponsesStreamTranscript,
} from "../shared/transcript-utils.js";

describe("responses streaming contract", () => {
  let serverCtx;
  let transcript;
  let toolCallTranscript;

  beforeAll(async () => {
    ensureResponsesTranscripts();
    transcript = await loadResponsesTranscript("streaming-text.json");
    toolCallTranscript = await loadResponsesTranscript("streaming-tool-call.json");
    serverCtx = await startServer({ CODEX_BIN: "scripts/fake-codex-proto.js" });
  }, 10_000);

  afterAll(async () => {
    if (serverCtx) await stopServer(serverCtx.child);
  });

  test("typed SSE matches transcript", async () => {
    const res = await fetch(`http://127.0.0.1:${serverCtx.PORT}/v1/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-sk-ci",
      },
      body: JSON.stringify(transcript.request),
    });
    expect(res.ok).toBe(true);
    const raw = await res.text();
    const actual = parseSSE(raw);
    const sanitized = sanitizeResponsesStreamTranscript(actual);
    expect(sanitized).toEqual(transcript.stream);
  });

  test("tool-call streaming sequence matches transcript", async () => {
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
        body: JSON.stringify(toolCallTranscript.request),
      });
      expect(res.ok).toBe(true);
      const raw = await res.text();
      const actual = parseSSE(raw);
      const sanitized = sanitizeResponsesStreamTranscript(actual);
      expect(sanitized).toEqual(toolCallTranscript.stream);
    } finally {
      await stopServer(toolServer.child);
    }
  });
});
