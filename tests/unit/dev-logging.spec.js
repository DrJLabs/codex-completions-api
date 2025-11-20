import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const resetEnv = () => {
  delete process.env.TOKEN_LOG_PATH;
  delete process.env.PROTO_LOG_PATH;
  delete process.env.SANITIZER_LOG_PATH;
  delete process.env.PROXY_ENV;
  delete process.env.PROXY_LOG_PROTO;
  delete process.env.PROXY_TRACE_REQUIRED;
};

const loadLogging = async () => {
  vi.resetModules();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dev-logging-"));
  process.env.TOKEN_LOG_PATH = path.join(dir, "token.ndjson");
  process.env.PROTO_LOG_PATH = path.join(dir, "proto.ndjson");
  process.env.SANITIZER_LOG_PATH = path.join(dir, "san.ndjson");
  process.env.PROXY_ENV = "dev";
  process.env.PROXY_LOG_PROTO = "true";
  process.env.PROXY_TRACE_REQUIRED = "false";
  const mod = await import("../../src/dev-logging.js");
  return { dir, ...mod };
};

afterEach(async () => {
  const paths = [
    process.env.TOKEN_LOG_PATH,
    process.env.PROTO_LOG_PATH,
    process.env.SANITIZER_LOG_PATH,
  ].filter(Boolean);
  resetEnv();
  for (const p of paths) {
    try {
      await fs.rm(path.dirname(p), { recursive: true, force: true });
    } catch {}
  }
});

describe("dev-logging helpers", () => {
  it("appendUsage applies canonical schema and redacts payload-like fields", async () => {
    const { appendUsage, __whenAppendIdle, TOKEN_LOG_PATH } = await loadLogging();
    appendUsage({
      route: "/v1/chat/completions",
      req_id: "req-123",
      payload: { prompt: "secret" },
      body: "sensitive",
      messages: [{ role: "user", content: "hidden" }],
      tokens_prompt: 5,
      tokens_response: 3,
      extra: "ok",
    });
    await __whenAppendIdle(TOKEN_LOG_PATH);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- test fixture path is set in setup
    const content = await fs.readFile(TOKEN_LOG_PATH, "utf8");
    const entry = JSON.parse(content.trim().split(/\n/).pop());
    expect(entry.component).toBe("usage");
    expect(entry.event).toBe("usage_summary");
    expect(entry.route).toBe("/v1/chat/completions");
    expect(entry.req_id).toBe("req-123");
    expect(entry.tokens_prompt).toBe(5);
    expect(entry.tokens_response).toBe(3);
    expect(entry.payload).toBe("[redacted]");
    expect(entry.body).toBe("[redacted]");
    expect(entry.messages).toBe("[redacted]");
    expect(entry.ts).toBeGreaterThan(0);
  });

  it("appendProtoEvent writes trace entries with schema and redaction", async () => {
    const { appendProtoEvent, __whenAppendIdle, PROTO_LOG_PATH } = await loadLogging();
    appendProtoEvent({
      route: "/v1/chat/completions",
      req_id: "req-456",
      event: "rpc_notification",
      body: { foo: "bar" },
      response: { data: "secret" },
      retryable: true,
      tokens_prompt: 2,
    });
    await __whenAppendIdle(PROTO_LOG_PATH);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- test fixture path is set in setup
    const content = await fs.readFile(PROTO_LOG_PATH, "utf8");
    const entry = JSON.parse(content.trim().split(/\n/).pop());
    expect(entry.component).toBe("trace");
    expect(entry.event).toBe("rpc_notification");
    expect(entry.route).toBe("/v1/chat/completions");
    expect(entry.req_id).toBe("req-456");
    expect(entry.retryable).toBe(true);
    expect(entry.tokens_prompt).toBe(2);
    expect(entry.body).toBe("[redacted]");
    expect(entry.response).toBe("[redacted]");
    expect(entry.ts).toBeGreaterThan(0);
  });
});
