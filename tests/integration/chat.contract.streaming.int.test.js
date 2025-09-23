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
