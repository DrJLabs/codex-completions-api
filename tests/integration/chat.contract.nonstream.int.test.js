import { describe, beforeAll, afterAll, test, expect } from "vitest";
import { startServer, stopServer } from "./helpers.js";
import {
  ensureTranscripts,
  loadTranscript,
  sanitizeNonStreamResponse,
} from "../shared/transcript-utils.js";
import { isKeployEnabled, runKeploySuite } from "../shared/keploy-runner.js";

const useKeploy = isKeployEnabled();

if (useKeploy) {
  describe("chat completion non-stream contract (Keploy)", () => {
    test("replay suite passes", async () => {
      await runKeploySuite({ label: "chat-contracts" });
    }, 60_000);
  });
} else {
  describe("chat completion non-stream contract", () => {
    let serverCtx;
    let transcript;

    beforeAll(async () => {
      ensureTranscripts(["nonstream-minimal.json"]);
      transcript = await loadTranscript("nonstream-minimal.json");
      serverCtx = await startServer({ CODEX_BIN: "scripts/fake-codex-proto.js" });
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
      const ctx = await startServer({ CODEX_BIN: "scripts/fake-codex-proto-no-complete.js" });
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
  });
}
