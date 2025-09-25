import { beforeAll, afterAll, test, expect, describe } from "vitest";
import { startServer, stopServer } from "./helpers.js";
import {
  ensureTranscripts,
  loadTranscript,
  sanitizeStreamTranscript,
  parseSSE,
} from "../shared/transcript-utils.js";

describe("chat completion streaming multi-choice", () => {
  let serverCtx;
  let transcript;

  beforeAll(async () => {
    ensureTranscripts(["streaming-multi-choice.json"]);
    transcript = await loadTranscript("streaming-multi-choice.json");
    serverCtx = await startServer({ CODEX_BIN: "scripts/fake-codex-proto.js" });
  }, 10_000);

  afterAll(async () => {
    if (serverCtx) await stopServer(serverCtx.child);
  });

  test("streams role, content, finish, and aggregated usage for all choices", async () => {
    const res = await fetch(`http://127.0.0.1:${serverCtx.PORT}/v1/chat/completions?stream=true`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-sk-ci",
      },
      body: JSON.stringify(transcript.request),
    });

    expect(res.ok).toBe(true);
    const raw = await res.text();
    const actualEntries = parseSSE(raw);
    const sanitized = sanitizeStreamTranscript(actualEntries);
    expect(sanitized).toEqual(transcript.stream);
  });
});
