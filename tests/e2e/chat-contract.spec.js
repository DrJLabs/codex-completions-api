import { test, expect } from "@playwright/test";
import {
  ensureTranscripts,
  loadTranscript,
  sanitizeNonStreamResponse,
  sanitizeStreamTranscript,
  parseSSE,
} from "../shared/transcript-utils.js";

test.describe("Chat contract baselines", () => {
  test.beforeAll(() => {
    ensureTranscripts();
  });

  test("non-stream response matches transcript", async ({ request }) => {
    const transcript = await loadTranscript("nonstream-minimal.json");
    const response = await request.post("/v1/chat/completions", {
      data: transcript.request,
    });
    expect(response.ok()).toBeTruthy();
    const payload = await response.json();
    const sanitized = sanitizeNonStreamResponse(payload);
    expect(sanitized).toEqual(transcript.response);
  });

  test("streaming SSE matches transcript", async ({ request }) => {
    const transcript = await loadTranscript("streaming-usage.json");
    const response = await request.fetch("/v1/chat/completions?stream=true", {
      method: "POST",
      data: transcript.request,
    });
    expect(response.ok()).toBeTruthy();
    const raw = await response.text();
    const actual = parseSSE(raw);
    const sanitized = sanitizeStreamTranscript(actual);
    expect(sanitized).toEqual(transcript.stream);
  });
});
