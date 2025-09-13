// @ts-check
import { test, expect } from "@playwright/test";

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
          if (l.startsWith(":")) continue; // keepalive/comment
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

test("finish_reason chunk precedes usage chunk when include_usage=true", async ({ baseURL }) => {
  const url = new URL("v1/chat/completions", baseURL).toString();
  const frames = await readSSE(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer test-sk-ci` },
    body: JSON.stringify({
      model: "codex-5",
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: "user", content: "Say hi." }],
    }),
  });

  // Must end with [DONE]
  expect(frames[frames.length - 1]?.trim()).toBe("[DONE]");

  // Map JSON frames, ignore [DONE]
  const objs = frames
    .map((d) => {
      try {
        return JSON.parse(d);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const finishIdx = objs.findIndex((o) => {
    const c = o?.choices?.[0];
    return o?.object === "chat.completion.chunk" && c && typeof c.finish_reason === "string";
  });
  const usageIdx = objs.findIndex((o) => {
    return (
      o?.object === "chat.completion.chunk" &&
      Array.isArray(o?.choices) &&
      o.choices.length === 0 &&
      o?.usage &&
      typeof o.usage.total_tokens === "number"
    );
  });

  expect(finishIdx).toBeGreaterThanOrEqual(0);
  expect(usageIdx).toBeGreaterThanOrEqual(0);
  expect(finishIdx).toBeLessThan(usageIdx);
});
