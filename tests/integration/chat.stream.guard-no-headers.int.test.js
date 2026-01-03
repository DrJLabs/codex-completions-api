import { afterAll, afterEach, test, expect } from "vitest";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnServer } from "./helpers.js";

let PORT;
let child;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const READY_PATH = path.join(process.cwd(), ".tmp-chat-guard-nohdr-ready.txt");
const RELEASE_PATH = path.join(process.cwd(), ".tmp-chat-guard-nohdr-release.txt");

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

const startServer = async (extraEnv = {}) => {
  await killChild();
  const server = await spawnServer(
    {
      PROXY_API_KEY: "test-sk-ci",
      PROXY_PROTECT_MODELS: "false",
      CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
      FAKE_CODEX_MODE: "long_stream",
      PROXY_SSE_MAX_CONCURRENCY: "1",
      PROXY_SSE_KEEPALIVE_MS: "0",
      PROXY_RATE_LIMIT_ENABLED: "false",
      PROXY_TEST_ENDPOINTS: "false",
      STREAM_READY_FILE: READY_PATH,
      STREAM_RELEASE_FILE: RELEASE_PATH,
      ...extraEnv,
    },
    { waitForReady: true }
  );
  PORT = server.PORT;
  child = server.child;
};

afterEach(async () => {
  await cleanTempFiles();
});

afterAll(async () => {
  await killChild();
  await cleanTempFiles();
});

test("streaming guard rejects without emitting test headers when test endpoints disabled", async () => {
  await startServer();

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

  await wait(200);

  let rejection;
  const attemptStart = Date.now();
  while (Date.now() - attemptStart < 2000 && !rejection) {
    const candidate = await fetch(url, {
      ...common,
      body: JSON.stringify({
        model: "codex-5",
        stream: true,
        messages: [{ role: "user", content: "reject" }],
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

  expect(rejection).toBeDefined();
  expect(rejection.headers.get("x-conc-before")).toBeNull();
  expect(rejection.headers.get("x-conc-after")).toBeNull();
  expect(rejection.headers.get("x-conc-limit")).toBeNull();
  const json429 = await rejection.json();
  expect(json429?.error?.code).toBe("concurrency_exceeded");

  await writeFile(RELEASE_PATH, String(Date.now()), "utf8");
  await background;
});
