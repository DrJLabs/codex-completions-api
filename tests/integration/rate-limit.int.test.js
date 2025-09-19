import { beforeAll, afterAll, test, expect } from "vitest";
import getPort from "get-port";
import { spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";

let PORT;
let child;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const READY_PATH = path.join(process.cwd(), ".tmp-stream-ready.txt");
const RELEASE_PATH = path.join(process.cwd(), ".tmp-stream-release.txt");

const killChild = async () => {
  if (!child || child.killed) return;
  await new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
    setTimeout(() => resolve(), 500);
  });
  child = undefined;
};

const waitForHealth = async () => {
  const start = Date.now();
  while (Date.now() - start < 5000) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (r.ok) return;
    } catch {}
    await wait(100);
  }
  throw new Error("server did not become healthy in time");
};

const startServer = async (extraEnv = {}) => {
  await killChild();
  child = spawn("node", ["server.js"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      PROXY_API_KEY: "test-sk-ci",
      PROXY_PROTECT_MODELS: "false",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForHealth();
};

const cleanTempFiles = async () => {
  await Promise.all([
    rm(READY_PATH, { force: true }).catch(() => {}),
    rm(RELEASE_PATH, { force: true }).catch(() => {}),
  ]);
};

beforeAll(async () => {
  PORT = await getPort();
});

afterAll(async () => {
  await killChild();
  await cleanTempFiles();
});

test("non-stream second request gets 429 from rate limiter", async () => {
  await startServer({
    CODEX_BIN: "scripts/fake-codex-proto.js",
    PROXY_RATE_LIMIT_ENABLED: "true",
    PROXY_RATE_LIMIT_WINDOW_MS: "100000",
    PROXY_RATE_LIMIT_MAX: "1",
  });

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

test("streaming concurrency guard deterministically rejects surplus streams", async () => {
  await cleanTempFiles();
  await startServer({
    CODEX_BIN: "scripts/fake-codex-proto-long.js",
    PROXY_RATE_LIMIT_ENABLED: "false",
    PROXY_SSE_MAX_CONCURRENCY: "1",
    PROXY_SSE_KEEPALIVE_MS: "0",
    PROXY_TEST_ENDPOINTS: "true",
    STREAM_READY_FILE: READY_PATH,
    STREAM_RELEASE_FILE: RELEASE_PATH,
  });

  const url = `http://127.0.0.1:${PORT}/v1/chat/completions`;
  const common = {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer test-sk-ci` },
  };

  for (let iteration = 0; iteration < 5; iteration += 1) {
    await cleanTempFiles();
    const res1 = await fetch(url, {
      ...common,
      body: JSON.stringify({
        model: "codex-5",
        stream: true,
        messages: [{ role: "user", content: `hold-${iteration}` }],
      }),
    });
    expect(res1.ok).toBeTruthy();

    const reader = res1.body.getReader();
    const background = (async () => {
      try {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      } catch {}
    })();

    await wait(200);

    const beforeHeader = Number(res1.headers.get("x-conc-before"));
    const afterHeader = Number(res1.headers.get("x-conc-after"));
    const limitHeader = Number(res1.headers.get("x-conc-limit"));
    expect(beforeHeader).toBe(0);
    expect(afterHeader).toBe(1);
    expect(limitHeader).toBe(1);

    let rejection;
    const attemptStart = Date.now();
    while (Date.now() - attemptStart < 2000 && !rejection) {
      const candidate = await fetch(url, {
        ...common,
        body: JSON.stringify({
          model: "codex-5",
          stream: true,
          messages: [{ role: "user", content: `reject-${iteration}` }],
        }),
      });
      if (candidate.status === 429) {
        rejection = candidate;
        break;
      }
      try {
        await candidate.body?.cancel?.();
      } catch {}
      await wait(50);
    }
    expect(rejection, "expected guard to reject second stream within 2s").toBeDefined();
    const headers429 = {
      before: Number(rejection.headers.get("x-conc-before")),
      after: Number(rejection.headers.get("x-conc-after")),
      limit: Number(rejection.headers.get("x-conc-limit")),
    };
    expect(headers429.before).toBe(1);
    expect(headers429.after).toBe(1);
    expect(headers429.limit).toBe(1);
    const json429 = await rejection.json();
    expect(json429?.error?.code).toBe("concurrency_exceeded");

    await writeFile(RELEASE_PATH, String(Date.now()), "utf8");
    await background;

    const startDrain = Date.now();
    while (Date.now() - startDrain < 2000) {
      const r = await fetch(`http://127.0.0.1:${PORT}/__test/conc`);
      const j = await r.json();
      if (Number(j.conc || 0) === 0) break;
      await wait(20);
    }
  }
});

test("guard headers are hidden when PROXY_TEST_ENDPOINTS is disabled", async () => {
  await cleanTempFiles();
  await startServer({
    CODEX_BIN: "scripts/fake-codex-proto-long.js",
    PROXY_RATE_LIMIT_ENABLED: "false",
    PROXY_SSE_MAX_CONCURRENCY: "1",
    PROXY_SSE_KEEPALIVE_MS: "0",
    PROXY_TEST_ENDPOINTS: "false",
    STREAM_READY_FILE: READY_PATH,
    STREAM_RELEASE_FILE: RELEASE_PATH,
  });

  const url = `http://127.0.0.1:${PORT}/v1/chat/completions`;
  const common = {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer test-sk-ci` },
  };

  await cleanTempFiles();
  const res1 = await fetch(url, {
    ...common,
    body: JSON.stringify({
      model: "codex-5",
      stream: true,
      messages: [{ role: "user", content: "hold" }],
    }),
  });
  expect(res1.ok).toBeTruthy();
  expect(res1.headers.get("x-conc-before")).toBeNull();
  expect(res1.headers.get("x-conc-after")).toBeNull();
  expect(res1.headers.get("x-conc-limit")).toBeNull();

  const reader = res1.body.getReader();
  const background = (async () => {
    try {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch {}
  })();

  await writeFile(RELEASE_PATH, String(Date.now()), "utf8");
  await background;
});
