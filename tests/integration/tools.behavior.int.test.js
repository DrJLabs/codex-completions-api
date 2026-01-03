import { beforeAll, afterAll, test, expect } from "vitest";
import { startServer, stopServer } from "./helpers.js";

let PORT;
let child;

async function collectSSE(url, init, { timeoutMs = 3000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
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
          if (l.startsWith(":")) continue;
          if (l.startsWith("data: ")) frames.push(l.slice(6));
        }
      }
      if (frames.some((d) => d.trim() === "[DONE]")) break;
    }
    return frames;
  } finally {
    clearTimeout(t);
  }
}

beforeAll(async () => {
  const server = await startServer({
    PROXY_API_KEY: "test-sk-ci",
    CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
    FAKE_CODEX_MODE: "textual_tool_tail",
    PROXY_PROTECT_MODELS: "false",
    PROXY_STOP_AFTER_TOOLS: "true",
    PROXY_STOP_AFTER_TOOLS_MODE: "first",
    PROXY_SSE_KEEPALIVE_MS: "0",
  });
  PORT = server.PORT;
  child = server.child;
});

afterAll(async () => {
  await stopServer(child);
});

// NOTE: stop-after-tools is enforced by the streaming handler.
// This test validates early cut after the first complete <use_tool> block.
test("early cut after first complete <use_tool> block", async () => {
  const frames = await collectSSE(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer test-sk-ci` },
    body: JSON.stringify({
      model: "codex-5",
      stream: true,
      messages: [{ role: "user", content: "hi" }],
    }),
  });
  const content = frames
    .map((d) => {
      try {
        const o = JSON.parse(d);
        return o?.choices?.[0]?.delta?.content || "";
      } catch {
        return "";
      }
    })
    .join("");
  expect(content.includes("AFTER_TOOL_TEXT")).toBe(false);
});
