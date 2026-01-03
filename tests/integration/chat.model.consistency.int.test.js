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
      // For this test, we only need the first JSON frame
      if (frames.length >= 1) break;
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
    PROXY_PROTECT_MODELS: "false",
  });
  PORT = server.PORT;
  child = server.child;
}, 10_000);

afterAll(async () => {
  await stopServer(child);
});

test("model string matches between stream and non-stream paths", async () => {
  // 1) Stream=true, capture first JSON frame
  const frames = await collectSSE(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer test-sk-ci` },
    body: JSON.stringify({ model: "codex-5", stream: true, messages: [{ role: "user", content: "hi" }] }),
  });
  expect(frames.length).toBeGreaterThanOrEqual(1);
  const first = JSON.parse(frames[0]);
  expect(first?.object).toBe("chat.completion.chunk");
  expect(typeof first?.model).toBe("string");

  // 2) Stream=false, compare model values
  const r = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer test-sk-ci` },
    body: JSON.stringify({ model: "codex-5", stream: false, messages: [{ role: "user", content: "hi" }] }),
  });
  expect(r.ok).toBeTruthy();
  const j = await r.json();
  expect(j?.object).toBe("chat.completion");
  expect(j?.model).toBe(first?.model);
});
