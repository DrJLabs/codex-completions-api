import { test, expect } from "vitest";
import fetch from "node-fetch";
import { startServer, stopServer } from "./helpers.js";

test("invalid JSON returns OpenAI-style JSON error with CORS headers", async () => {
  const ctx = await startServer({
    PROXY_API_KEY: "test-sk-ci",
  });
  const base = `http://127.0.0.1:${ctx.PORT}`;
  try {
    const origin = "https://example.com";
    const r = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        Authorization: "Bearer test-sk-ci",
      },
      // Malformed JSON should trigger express.json parse failure
      body: "{bad",
    });
    expect(r.status).toBe(400);
    expect((r.headers.get("content-type") || "").toLowerCase()).toContain("application/json");
    expect(r.headers.get("access-control-allow-origin")).toBe(origin);
    expect(r.headers.get("x-request-id")).toBeTruthy();

    const body = await r.json();
    expect(body?.error?.type).toBe("invalid_request_error");
  } finally {
    await stopServer(ctx.child);
  }
});
