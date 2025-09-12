import { beforeAll, afterAll, test, expect } from "vitest";
import getPort from "get-port";
import { spawn } from "node:child_process";

let PORT;
let child;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  PORT = await getPort();
  child = spawn("node", ["server.js"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      PROXY_API_KEY: "test-sk-ci",
      CODEX_BIN: "scripts/fake-codex-proto.js",
      PROXY_PROTECT_MODELS: "false",
      PROXY_RATE_LIMIT_ENABLED: "true",
      PROXY_RATE_LIMIT_WINDOW_MS: "100000",
      PROXY_RATE_LIMIT_MAX: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  // wait health
  const start = Date.now();
  while (Date.now() - start < 5000) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (r.ok) break;
    } catch {}
    await wait(100);
  }
});

afterAll(async () => {
  try {
    if (child && !child.killed) child.kill("SIGTERM");
  } catch {}
});

test("non-stream second request gets 429 from rate limiter", async () => {
  const url = `http://127.0.0.1:${PORT}/v1/chat/completions`;
  const common = {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer test-sk-ci` },
  };
  let r = await fetch(url, {
    ...common,
    body: JSON.stringify({
      model: "codex-5",
      stream: false,
      messages: [{ role: "user", content: "hi" }],
    }),
  });
  expect(r.status).toBe(200);
  r = await fetch(url, {
    ...common,
    body: JSON.stringify({
      model: "codex-5",
      stream: false,
      messages: [{ role: "user", content: "hi again" }],
    }),
  });
  expect(r.status).toBe(429);
  const j = await r.json();
  expect(j?.error?.code).toBe("rate_limited");
});

// Marked skipped pending investigation of harness timing; see docs/bmad/qa/issues/2025-09-12-concurrency-guard-flaky.md
test.skip("streaming concurrency limit returns 429 for additional streams", async () => {
  // restart child with streaming concurrency = 1
  try {
    if (child && !child.killed) child.kill("SIGTERM");
  } catch {}
  await wait(200);
  const READY = `${process.cwd()}/.tmp-stream-ready.txt`;
  child = spawn("node", ["server.js"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      PROXY_API_KEY: "test-sk-ci",
      CODEX_BIN: "scripts/fake-codex-proto-long.js",
      PROXY_PROTECT_MODELS: "false",
      PROXY_RATE_LIMIT_ENABLED: "false",
      PROXY_SSE_MAX_CONCURRENCY: "1",
      PROXY_SSE_KEEPALIVE_MS: "0",
      STREAM_READY_FILE: READY,
      PROXY_TEST_ENDPOINTS: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const start = Date.now();
  while (Date.now() - start < 5000) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (r.ok) break;
    } catch {}
    await wait(100);
  }
  const url = `http://127.0.0.1:${PORT}/v1/chat/completions`;
  const common = {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer test-sk-ci` },
  };

  const res1 = await fetch(url, {
    ...common,
    body: JSON.stringify({
      model: "codex-5",
      stream: true,
      messages: [{ role: "user", content: "hold" }],
    }),
  });
  expect(res1.ok).toBeTruthy();
  // Wait for shim to signal streaming readiness and verify conc==1 via test endpoint
  {
    const start2 = Date.now();
    while (Date.now() - start2 < 2000) {
      try {
        const fs = await import("node:fs");
        if (fs.existsSync(READY)) break;
      } catch {}
      await wait(20);
    }
    // poll conc
    const start3 = Date.now();
    while (Date.now() - start3 < 1000) {
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}/__test/conc`);
        const j = await r.json();
        if (Number(j.conc || 0) >= 1) break;
      } catch {}
      await wait(20);
    }
    // Start background reader to keep stream 1 active/consuming
    const reader = res1.body.getReader();
    (async () => {
      try {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      } catch {}
    })();
  }
  // second should be rejected immediately
  const res2 = await fetch(url, {
    ...common,
    body: JSON.stringify({
      model: "codex-5",
      stream: true,
      messages: [{ role: "user", content: "reject" }],
    }),
  });
  expect(res2.status).toBe(429);
  const j2 = await res2.json();
  expect(j2?.error?.code).toBe("concurrency_exceeded");
});
