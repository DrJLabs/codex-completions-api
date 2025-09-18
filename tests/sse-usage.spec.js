// @ts-check
import { test, expect } from "@playwright/test";

// Simple SSE collector for tests
async function readSSE(url, init, opts = {}) {
  const { timeoutMs = 15000 } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    expect(res.ok).toBeTruthy();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const frames = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const lines = chunk.split(/\n/);
        for (const l of lines) {
          if (l.startsWith(":")) continue; // comment/keepalive
          if (l.startsWith("data: ")) frames.push(l.slice(6));
        }
      }
      if (frames.some((d) => d.trim() === "[DONE]")) break;
    }
    return frames;
  } finally {
    clearTimeout(timer);
  }
}

test("include_usage emits a final usage chunk before [DONE]", async ({ baseURL }) => {
  const url = new URL("v1/chat/completions", baseURL).toString();
  const frames = await readSSE(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer test-sk-ci` },
    body: JSON.stringify({
      model: "codex-5",
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: "user", content: "Say hello quickly." }],
    }),
  });

  // Must end with [DONE]
  expect(frames[frames.length - 1]?.trim()).toBe("[DONE]");

  // Find a usage chunk with empty choices
  let usageChunk = null;
  const usageIdx = frames.findIndex((d) => {
    try {
      const o = JSON.parse(d);
      return o?.object === "chat.completion.chunk" &&
        Array.isArray(o?.choices) &&
        o.choices.length === 0 &&
        o?.usage &&
        typeof o.usage.prompt_tokens === "number" &&
        typeof o.usage.total_tokens === "number"
        ? ((usageChunk = o), true)
        : false;
    } catch {
      return false;
    }
  });
  expect(usageIdx).toBeGreaterThanOrEqual(0);

  // The usage chunk should appear before [DONE]
  expect(usageIdx).toBeLessThan(frames.length - 1);

  // Ensure no custom `{event:"usage"}` frames are present
  const hasLegacyUsageEvent = frames.some((d) => {
    try {
      const o = JSON.parse(d);
      return o && o.event === "usage";
    } catch {
      return false;
    }
  });
  expect(hasLegacyUsageEvent).toBeFalsy();
  expect(usageChunk.usage?.emission_trigger).toBe("token_count");
});
