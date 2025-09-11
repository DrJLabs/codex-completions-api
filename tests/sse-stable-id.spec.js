// @ts-check
import { test, expect } from "@playwright/test";

async function collectSSE(url, init, { timeoutMs = 15000 } = {}) {
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
        for (const line of chunk.split("\n")) {
          if (line.startsWith(":")) continue; // keepalive comment
          if (line.startsWith("data: ")) frames.push(line.slice(6));
        }
      }
      if (frames.some((d) => d.trim() === "[DONE]")) break;
    }
    return frames;
  } finally {
    clearTimeout(timer);
  }
}

test("chat stream uses a stable id across chunks", async ({ baseURL }) => {
  const url = new URL("v1/chat/completions", baseURL).toString();
  const frames = await collectSSE(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer test-sk-ci` },
    body: JSON.stringify({
      model: "codex-5",
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: "user", content: "Say something short." }],
    }),
  });

  const chunks = frames
    .map((d) => {
      try {
        return JSON.parse(d);
      } catch {
        return null;
      }
    })
    .filter((o) => o && o.object === "chat.completion.chunk");

  expect(chunks.length).toBeGreaterThanOrEqual(2);
  const firstId = chunks[0].id;
  const lastId = chunks[chunks.length - 1].id;
  expect(typeof firstId).toBe("string");
  expect(lastId).toBe(firstId);
});
