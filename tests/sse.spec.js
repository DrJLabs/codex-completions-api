// @ts-check
import { test, expect } from "@playwright/test";

// Lightweight SSE reader using Fetch streaming
async function readSSE(url, init, { maxEvents = 10, timeoutMs = 10_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const events = [];
    while (events.length < maxEvents) {
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
          if (l.startsWith("data: ")) {
            const data = l.slice(6);
            events.push(data);
          }
        }
        if (events.length >= maxEvents) break;
      }
    }
    return events;
  } finally {
    clearTimeout(timer);
  }
}

test("chat completions streaming yields role + DONE", async ({ baseURL }) => {
  const url = new URL("v1/chat/completions", baseURL).toString();
  const events = await readSSE(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer test-sk-ci`,
      },
      body: JSON.stringify({
        model: "codex-5",
        stream: true,
        reasoning: { effort: "high" },
        messages: [{ role: "user", content: "Say hello." }],
      }),
    },
    { maxEvents: 50, timeoutMs: 15_000 }
  );

  // Ensure we saw [DONE]
  expect(events.some((d) => d.trim() === "[DONE]")).toBeTruthy();

  // Ensure we saw an initial role delta event
  const hasRoleDelta = events.some((d) => {
    try {
      const obj = JSON.parse(d);
      return (
        obj?.object === "chat.completion.chunk" && obj?.choices?.[0]?.delta?.role === "assistant"
      );
    } catch {
      return false;
    }
  });
  expect(hasRoleDelta).toBeTruthy();

  // Ensure we saw a finalizer with finish_reason
  const hasFinishReason = events.some((d) => {
    try {
      const obj = JSON.parse(d);
      const choice = obj?.choices?.[0];
      return (
        obj?.object === "chat.completion.chunk" &&
        choice &&
        typeof choice.finish_reason === "string"
      );
    } catch {
      return false;
    }
  });
  expect(hasFinishReason).toBeTruthy();
});
