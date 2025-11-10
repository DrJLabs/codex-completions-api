import { describe, beforeAll, afterAll, test, expect } from "vitest";
import { startServer, stopServer } from "./helpers.js";
import {
  ensureTranscripts,
  loadTranscript,
  sanitizeStreamTranscript,
  parseSSE,
} from "../shared/transcript-utils.js";

const STREAM_SCENARIOS = [
  {
    label: "stop",
    transcriptFile: "streaming-usage.json",
    env: {},
  },
  {
    label: "length",
    transcriptFile: "streaming-usage-length.json",
    env: { FAKE_CODEX_FINISH_REASON: "length" },
  },
  {
    label: "tool_calls",
    transcriptFile: "streaming-tool-calls.json",
    env: { FAKE_CODEX_MODE: "tool_call" },
  },
  {
    label: "tool_calls_sequential",
    transcriptFile: "streaming-tool-calls-sequential.json",
    env: { FAKE_CODEX_MODE: "tool_call", FAKE_CODEX_PARALLEL: "false" },
  },
  {
    label: "function_call",
    transcriptFile: "streaming-function-call.json",
    env: { FAKE_CODEX_MODE: "function_call" },
  },
  {
    label: "content_filter",
    transcriptFile: "streaming-content-filter.json",
    env: { FAKE_CODEX_MODE: "content_filter" },
  },
];

describe.each(STREAM_SCENARIOS)(
  "chat completion streaming contract (%s)",
  ({ label, transcriptFile, env }) => {
    let serverCtx;
    let transcript;

    beforeAll(async () => {
      ensureTranscripts(STREAM_SCENARIOS.map((scenario) => scenario.transcriptFile));
      transcript = await loadTranscript(transcriptFile);
      serverCtx = await startServer({ CODEX_BIN: "scripts/fake-codex-proto.js", ...env });
    }, 10_000);

    afterAll(async () => {
      if (serverCtx) await stopServer(serverCtx.child);
    });

    test(`streaming SSE order and usage match golden transcript (${label})`, async () => {
      const res = await fetch(
        `http://127.0.0.1:${serverCtx.PORT}/v1/chat/completions?stream=true`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer test-sk-ci",
          },
          body: JSON.stringify(transcript.request),
        }
      );

      expect(res.ok).toBe(true);
      const raw = await res.text();
      const actualEntries = parseSSE(raw);
      const sanitized = sanitizeStreamTranscript(actualEntries);
      expect(sanitized).toEqual(transcript.stream);
    });
  }
);

describe("chat completion streaming output mode overrides", () => {
  let serverCtx;
  let transcript;

  beforeAll(async () => {
    ensureTranscripts(["streaming-tool-calls.json"]);
    transcript = await loadTranscript("streaming-tool-calls.json");
    serverCtx = await startServer({
      CODEX_BIN: "scripts/fake-codex-proto.js",
      FAKE_CODEX_MODE: "tool_call",
    });
  }, 10_000);

  afterAll(async () => {
    if (serverCtx) await stopServer(serverCtx.child);
  });

  test("openai-json override suppresses obsidian content chunks", async () => {
    const res = await fetch(`http://127.0.0.1:${serverCtx.PORT}/v1/chat/completions?stream=true`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-sk-ci",
        "x-proxy-output-mode": "openai-json",
      },
      body: JSON.stringify(transcript.request),
    });

    expect(res.ok).toBe(true);
    const raw = await res.text();
    const entries = parseSSE(raw);
    const hasContentChunk = entries.some((entry) => {
      if (entry?.type !== "data" || !entry?.data?.choices) return false;
      return entry.data.choices.some(
        (choice) => typeof choice?.delta?.content === "string" && choice.delta.content.length
      );
    });
    expect(hasContentChunk).toBe(false);
    const finishFrame = entries.find(
      (entry) =>
        entry?.type === "data" &&
        entry?.data?.choices?.some((choice) => choice.finish_reason === "tool_calls")
    );
    expect(finishFrame).toBeTruthy();
  });
});
