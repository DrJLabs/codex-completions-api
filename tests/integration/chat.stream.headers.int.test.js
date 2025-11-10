import { afterEach, describe, expect, test } from "vitest";
import fetch from "node-fetch";
import { startServer, stopServer } from "./helpers.js";

describe("chat streaming SSE headers", () => {
  let serverCtx;

  afterEach(async () => {
    if (serverCtx) {
      await stopServer(serverCtx.child);
      serverCtx = null;
    }
  });

  test("sets required headers and flushes first chunk promptly", async () => {
    serverCtx = await startServer({
      FAKE_CODEX_MODE: "tool_call",
      PROXY_SSE_KEEPALIVE_MS: "0",
    });

    const controller = new AbortController();
    const response = await fetch(
      `http://127.0.0.1:${serverCtx.PORT}/v1/chat/completions?stream=true`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-sk-ci",
        },
        body: JSON.stringify({
          model: "codex-5",
          stream: true,
          messages: [{ role: "user", content: "trigger tool" }],
        }),
        signal: controller.signal,
      }
    );

    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(response.headers.get("connection")).toBe("keep-alive");
    expect(response.headers.get("x-accel-buffering")).toBe("no");

    const iterator = response.body[Symbol.asyncIterator]();
    const start = Date.now();
    const firstChunk = await iterator.next();
    const elapsed = Date.now() - start;
    expect(firstChunk.done).toBe(false);
    expect(elapsed).toBeLessThan(1000);
    const text = Buffer.from(firstChunk.value).toString("utf8");
    expect(text).toMatch(/data:/);

    controller.abort();
  });
});
