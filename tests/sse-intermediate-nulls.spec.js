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
        for (const l of chunk.split("\n")) {
          if (l.startsWith(":")) continue;
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

test("intermediate chunks include finish_reason:null and usage:null", async ({ baseURL }) => {
  const url = new URL("v1/chat/completions", baseURL).toString();
  const frames = await readSSE(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer test-sk-ci` },
    body: JSON.stringify({
      model: "codex-5",
      stream: true,
      messages: [{ role: "user", content: "Two words reply" }],
    }),
  });
  const objs = frames
    .map((d) => {
      try {
        return JSON.parse(d);
      } catch {
        return null;
      }
    })
    .filter((o) => o && o.object === "chat.completion.chunk");

  expect(objs.length).toBeGreaterThan(1);

  // Identify finish_reason and usage chunks
  const finishIdx = objs.findIndex((o) => {
    const choices = Array.isArray(o?.choices) ? o.choices : [];
    const c0 = choices.at(0);
    return Boolean(c0 && c0.finish_reason);
  });
  // Keep detection logic for completeness if needed later

  // All intermediate (before finishIdx) must have finish_reason:null and usage:null
  const limit = finishIdx >= 0 ? finishIdx : objs.length;
  for (const [idx, obj] of objs.entries()) {
    if (idx >= limit) break;
    const choices = Array.isArray(obj.choices) ? obj.choices : [];
    const c = choices.at(0);
    expect(c).toBeTruthy();
    expect(c.finish_reason).toBe(null);
    expect(obj).toHaveProperty("usage");
    expect(obj.usage).toBe(null);
  }

  // Finish chunk (if present) must have usage:null
  expect(finishIdx).toBeGreaterThanOrEqual(0);
  expect(objs.at(finishIdx).usage).toBe(null);
});
