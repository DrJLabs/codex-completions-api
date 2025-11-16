/* eslint-disable security/detect-non-literal-fs-filename */
import { beforeAll, afterAll, afterEach, test, expect } from "vitest";
import { spawn } from "node:child_process";
import getPort from "get-port";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const readJsonLines = async (filePath) => {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return content
      .split(/\n+/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    throw err;
  }
};

let PORT;
let child;
let tempDir;
let protoLog;
let usageLog;
let sanitizeLog;

const startServer = async () => {
  PORT = await getPort();
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tracing-"));
  protoLog = path.join(tempDir, "proto.ndjson");
  usageLog = path.join(tempDir, "usage.ndjson");
  sanitizeLog = path.join(tempDir, "sanitize.ndjson");
  child = spawn("node", ["server.js"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      PROXY_API_KEY: "test-sk-ci",
      PROXY_ENV: "dev",
      PROXY_TRACE_REQUIRED: "true",
      PROXY_LOG_PROTO: "true",
      PROXY_USE_APP_SERVER: "true",
      PROTO_LOG_PATH: protoLog,
      TOKEN_LOG_PATH: usageLog,
      SANITIZER_LOG_PATH: sanitizeLog,
      CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
      PROXY_PROTECT_MODELS: "false",
      PROXY_SANDBOX_MODE: "read-only",
      PROXY_CODEX_WORKDIR: tempDir,
    },
    stdio: "ignore",
  });
  const start = Date.now();
  while (Date.now() - start < 8000) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (res.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("dev server failed to start for tracing tests");
};

const stopServer = async () => {
  if (child && !child.killed) {
    try {
      child.kill("SIGTERM");
    } catch {}
  }
  child = null;
  if (tempDir) {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {}
  }
};

beforeAll(async () => {
  await startServer();
});

afterAll(async () => {
  await stopServer();
});

afterEach(async () => {
  await fs.writeFile(protoLog, "", "utf8");
  await fs.writeFile(usageLog, "", "utf8");
});

test("streaming request logs http ingress, backend, client egress, and usage with shared req_id", async () => {
  const payload = {
    model: "codex-5",
    stream: true,
    messages: [{ role: "user", content: "trace me" }],
  };
  const response = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-sk-ci" },
    body: JSON.stringify(payload),
  });
  expect(response.ok).toBe(true);
  const reader = response.body.getReader();
  // consume stream fully
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  const protoEvents = await readJsonLines(protoLog);
  const usageEvents = await readJsonLines(usageLog);
  expect(protoEvents.length).toBeGreaterThan(0);
  expect(usageEvents.length).toBeGreaterThan(0);
  const reqIds = new Set(protoEvents.map((e) => e.req_id).filter(Boolean));
  expect(reqIds.size).toBe(1);
  const [reqId] = reqIds;
  expect(reqId).toBeTruthy();
  expect(
    usageEvents.some((entry) => entry.req_id === reqId && entry.phase === "usage_summary")
  ).toBe(true);
  const hasIngress = protoEvents.some((e) => e.phase === "http_ingress" && e.req_id === reqId);
  const hasBackend = protoEvents.some(
    (e) => e.phase === "backend_submission" && e.req_id === reqId
  );
  expect(hasIngress).toBe(true);
  expect(hasBackend).toBe(true);

  const clientSseEvents = protoEvents.filter(
    (event) => event.kind === "client_sse" && event.req_id === reqId
  );
  expect(clientSseEvents.length).toBeGreaterThan(0);
  for (const event of clientSseEvents) {
    expect(event.phase).toBe("client_egress");
    expect(event.direction).toBe("outbound");
    expect(event.route).toBe("/v1/chat/completions");
    expect(event.mode).toBe("chat_stream");
  }

  const doneEvents = protoEvents.filter(
    (event) => event.kind === "client_sse_done" && event.req_id === reqId
  );
  expect(doneEvents).toHaveLength(1);
  expect(doneEvents[0].phase).toBe("client_egress");
  expect(doneEvents[0].direction).toBe("outbound");
  expect(doneEvents[0].route).toBe("/v1/chat/completions");
  expect(doneEvents[0].mode).toBe("chat_stream");
});

test("non-streaming request logs client_json egress event", async () => {
  const payload = {
    model: "codex-5",
    stream: false,
    messages: [{ role: "user", content: "non-stream" }],
  };
  const response = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-sk-ci" },
    body: JSON.stringify(payload),
  });
  expect(response.ok).toBe(true);
  await response.json();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const protoEvents = await readJsonLines(protoLog);
  const clientJsonEvents = protoEvents.filter((event) => event.kind === "client_json");
  expect(clientJsonEvents.length).toBeGreaterThan(0);
  for (const event of clientJsonEvents) {
    expect(event.phase).toBe("client_egress");
    expect(event.direction).toBe("outbound");
    expect(event.route).toBe("/v1/chat/completions");
    expect(event.mode).toBe("chat_nonstream");
    expect(typeof event.status_code).toBe("number");
    expect(event.status_code).toBeGreaterThanOrEqual(200);
    expect(event.status_code).toBeLessThan(600);
  }
});
