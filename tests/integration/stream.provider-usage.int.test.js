import { beforeAll, afterAll, test, expect } from "vitest";
import getPort from "get-port";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let PORT;
let child;
let tokenLogDir;
let tokenLogPath;

async function collectSSE(url, init, { timeoutMs = 5000 } = {}) {
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

beforeAll(async () => {
  PORT = await getPort();
  tokenLogDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-usage-provider-"));
  tokenLogPath = path.join(tokenLogDir, "usage.ndjson");
  child = spawn("node", ["server.js"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      PROXY_API_KEY: "test-sk-ci",
      PROXY_PROTECT_MODELS: "false",
      PROXY_SSE_KEEPALIVE_MS: "0",
      CODEX_BIN: "scripts/fake-codex-proto-provider-usage.js",
      TOKEN_LOG_PATH: tokenLogPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const start = Date.now();
  while (Date.now() - start < 5000) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (r.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
});

afterAll(() => {
  try {
    if (child && !child.killed) child.kill("SIGTERM");
  } catch {}
  if (tokenLogDir) {
    try {
      fs.rmSync(tokenLogDir, { recursive: true, force: true });
    } catch {}
  }
});

test("provider usage event is logged without emitting client usage chunk", async () => {
  const frames = await collectSSE(
    `http://127.0.0.1:${PORT}/v1/chat/completions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer test-sk-ci` },
      body: JSON.stringify({
        model: "codex-5",
        stream: true,
        messages: [{ role: "user", content: "Provider usage scenario" }],
      }),
    },
    { timeoutMs: 5000 }
  );

  expect(frames[frames.length - 1]?.trim()).toBe("[DONE]");

  const objs = frames
    .map((d) => {
      try {
        return JSON.parse(d);
      } catch {
        return null;
      }
    })
    .filter((o) => o && o.object === "chat.completion.chunk");

  const usageChunk = objs.find(
    (o) =>
      Array.isArray(o.choices) && o.choices.length === 0 && o.usage && typeof o.usage === "object"
  );
  expect(usageChunk).toBeUndefined();

  const finishChunk = objs.find((o) => {
    const c = o?.choices?.[0];
    return c && typeof c.finish_reason === "string";
  });
  expect(finishChunk).toBeTruthy();

  let logRaw = "";
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- test temp file path
    if (fs.existsSync(tokenLogPath)) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- test temp file path
      logRaw = fs.readFileSync(tokenLogPath, "utf8");
    }
  } catch {}
  const entries = logRaw
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  expect(entries.length).toBeGreaterThan(0);
  const last = entries[entries.length - 1];
  expect(last?.emission_trigger).toBe("provider");
  expect(last?.usage_included).toBe(false);
  expect(last?.provider_supplied).toBe(true);
  expect(typeof last?.prompt_tokens).toBe("number");
  expect(typeof last?.completion_tokens).toBe("number");
});
