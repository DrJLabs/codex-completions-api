import { beforeAll, afterAll, test, expect } from "vitest";
import getPort from "get-port";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { wait } from "./helpers.js";
import { __whenAppendIdle } from "../../src/dev-logging.js";

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
  tokenLogDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-usage-token-count-"));
  tokenLogPath = path.join(tokenLogDir, "usage.ndjson");
  child = spawn("node", ["server.js"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      PROXY_API_KEY: "test-sk-ci",
      PROXY_PROTECT_MODELS: "false",
      PROXY_SSE_KEEPALIVE_MS: "0",
      CODEX_BIN: "scripts/fake-codex-proto-token-count-only.js",
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

test("token_count-only proto yields finish_reason length and usage emission", async () => {
  const frames = await collectSSE(
    `http://127.0.0.1:${PORT}/v1/chat/completions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer test-sk-ci` },
      body: JSON.stringify({
        model: "codex-5",
        stream: true,
        stream_options: { include_usage: true },
        messages: [{ role: "user", content: "Trigger token-count only." }],
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
    .filter(Boolean);

  let finishChunk = null;
  for (const o of objs) {
    const c = Array.isArray(o?.choices) ? o.choices.find(() => true) : null;
    if (o?.object === "chat.completion.chunk" && c && typeof c.finish_reason === "string") {
      finishChunk = o;
      break;
    }
  }
  expect(finishChunk).toBeTruthy();
  const finishChoice =
    Array.isArray(finishChunk?.choices) && finishChunk.choices.length > 0
      ? finishChunk.choices.find(() => true)
      : null;
  expect(finishChoice?.finish_reason).toBe("length");

  let usageMatches = 0;
  let usageChunk = null;
  for (const o of objs) {
    if (
      o?.object === "chat.completion.chunk" &&
      Array.isArray(o?.choices) &&
      o.choices.length === 0 &&
      o?.usage
    ) {
      usageMatches += 1;
      usageChunk = o;
    }
  }
  expect(usageMatches).toBe(1);
  expect(usageChunk?.usage?.emission_trigger).toBe("token_count");

  const readLogs = () => {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- test temp file path
      if (fs.existsSync(tokenLogPath)) {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- test temp file path
        return fs.readFileSync(tokenLogPath, "utf8");
      }
    } catch {}
    return "";
  };

  await __whenAppendIdle(tokenLogPath);
  let logRaw = readLogs();
  const pollStart = Date.now();
  while (!logRaw.trim() && Date.now() - pollStart < 1000) {
    await wait(25);
    await __whenAppendIdle(tokenLogPath);
    logRaw = readLogs();
  }
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
  expect(last?.emission_trigger).toBe("token_count");
  expect(last?.usage_included).toBe(true);
  expect(last?.provider_supplied).toBe(false);
  expect(typeof last?.prompt_tokens).toBe("number");
  expect(typeof last?.completion_tokens).toBe("number");
});
