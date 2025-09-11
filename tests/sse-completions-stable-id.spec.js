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
          if (line.startsWith(":")) continue; // keepalive
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

test("legacy completions stream uses a stable id across chunks", async ({ baseURL }) => {
  const url = new URL("v1/completions", baseURL).toString();
  const frames = await collectSSE(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer test-sk-ci` },
    body: JSON.stringify({ model: "codex-5", stream: true, prompt: "Say hi" }),
  });

  const chunks = frames
    .map((d) => {
      try {
        return JSON.parse(d);
      } catch {
        return null;
      }
    })
    .filter((o) => o && o.object === "text_completion.chunk");
  expect(chunks.length).toBeGreaterThanOrEqual(1);
  const uniqueIds = [...new Set(chunks.map((c) => c.id))];
  expect(uniqueIds.length).toBe(1);
  expect(typeof uniqueIds[0]).toBe("string");
});
