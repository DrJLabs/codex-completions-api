import { beforeAll, afterAll, afterEach, test, expect } from "vitest";
import getPort from "get-port";
import { spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";

let PORT;
let child;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const READY_PATH = path.join(process.cwd(), ".tmp-responses-stream-ready.txt");
const RELEASE_PATH = path.join(process.cwd(), ".tmp-responses-stream-release.txt");

const killChild = async () => {
  if (!child || child.killed) return;
  await new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
    setTimeout(() => resolve(), 500);
  });
  child = undefined;
};

const cleanTempFiles = async () => {
  await Promise.all([
    rm(READY_PATH, { force: true }).catch(() => {}),
    rm(RELEASE_PATH, { force: true }).catch(() => {}),
  ]);
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
      CODEX_BIN: "scripts/fake-codex-proto-long.js",
      PROXY_SSE_MAX_CONCURRENCY: "1",
      PROXY_SSE_KEEPALIVE_MS: "0",
      PROXY_RATE_LIMIT_ENABLED: "false",
      PROXY_TEST_ENDPOINTS: "true",
      STREAM_READY_FILE: READY_PATH,
      STREAM_RELEASE_FILE: RELEASE_PATH,
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForHealth();
};

beforeAll(async () => {
  PORT = await getPort();
});

afterEach(async () => {
  await cleanTempFiles();
});

afterAll(async () => {
  await killChild();
  await cleanTempFiles();
});

test("responses streaming enforces concurrency guard", async () => {
  await startServer();

  const url = `http://127.0.0.1:${PORT}/v1/responses`;
  const common = {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-sk-ci" },
  };

  for (let iteration = 0; iteration < 3; iteration += 1) {
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

    expect(rejection, "expected guard to reject within 2s").toBeDefined();
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

    const drainStart = Date.now();
    while (Date.now() - drainStart < 2000) {
      const r = await fetch(`http://127.0.0.1:${PORT}/__test/conc`);
      const j = await r.json();
      if (Number(j.conc || 0) === 0) break;
      await wait(20);
    }
  }
});
