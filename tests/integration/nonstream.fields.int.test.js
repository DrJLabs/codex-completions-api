import { beforeAll, afterAll, test, expect } from "vitest";
import getPort from "get-port";
import { spawn } from "node:child_process";
import fetch from "node-fetch";
import { waitForReady } from "./helpers.js";

let PORT;
let child;

beforeAll(async () => {
  PORT = await getPort();
  child = spawn("node", ["server.js"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      PROXY_API_KEY: "test-sk-ci",
      CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
      PROXY_PROTECT_MODELS: "false",
    },
    stdio: "ignore",
  });
  const start = Date.now();
  while (Date.now() - start < 5000) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (r.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  await waitForReady(PORT);
}, 10_000);

afterAll(async () => {
  if (child && !child.killed) {
    try {
      child.kill("SIGTERM");
    } catch {}
  }
});

test("chat non-stream includes required fields and usage", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer test-sk-ci` },
    body: JSON.stringify({
      model: "codex-5",
      stream: false,
      messages: [{ role: "user", content: "hello" }],
    }),
  });
  expect(r.ok).toBeTruthy();
  const j = await r.json();
  expect(j?.object).toBe("chat.completion");
  expect(typeof j?.id).toBe("string");
  expect(typeof j?.created).toBe("number");
  expect(typeof j?.model).toBe("string");
  const ch = j?.choices?.[0];
  expect(ch?.index).toBe(0);
  expect(ch?.message?.role).toBe("assistant");
  expect(typeof ch?.message?.content).toBe("string");
  expect(["stop", "length", "tool_calls", "content_filter", "function_call"]).toContain(
    ch?.finish_reason
  );
  expect(typeof j?.usage?.prompt_tokens).toBe("number");
  expect(typeof j?.usage?.completion_tokens).toBe("number");
  expect(typeof j?.usage?.total_tokens).toBe("number");
});
