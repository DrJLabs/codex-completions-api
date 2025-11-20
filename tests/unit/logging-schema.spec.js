import { describe, expect, it } from "vitest";
import { applyLogSchema, buildLogEntry } from "../../src/services/logging/schema.js";

describe("logging schema", () => {
  it("adds canonical fields and preserves extras", () => {
    const ts = 1_700_000_000_000;
    const base = buildLogEntry({
      component: "worker",
      event: "worker_ready",
      level: "info",
      req_id: "req_123",
      route: "/v1/chat/completions",
      model: "codex-5",
      latency_ms: 42,
      tokens_prompt: 10,
      tokens_response: 5,
      worker_state: "ready",
      restart_count: 2,
      backoff_ms: 500,
      maintenance_mode: false,
      error_code: null,
      retryable: false,
      ts_ms: ts,
    });
    expect(base.timestamp).toBe(new Date(ts).toISOString());
    expect(base.ts).toBe(ts);
    expect(base.component).toBe("worker");
    expect(base.event).toBe("worker_ready");
    expect(base.worker_state).toBe("ready");
    expect(base.restart_count).toBe(2);
    expect(base.backoff_ms).toBe(500);
  });

  it("redacts payload-style keys", () => {
    const entry = applyLogSchema(
      {
        payload: { prompt: "secret" },
        body: "sensitive",
        headers: { auth: "token" },
        ok: true,
      },
      { component: "trace", event: "proto_event" }
    );
    expect(entry.payload).toBe("[redacted]");
    expect(entry.body).toBe("[redacted]");
    expect(entry.headers).toBe("[redacted]");
    expect(entry.ok).toBe(true);
    expect(entry.timestamp).toBeDefined();
    expect(entry.ts).toBeGreaterThan(0);
  });

  it("does not allow extras to override canonical fields", () => {
    const entry = applyLogSchema(
      {
        event: "override_event",
        level: "debug",
        req_id: "extra-req",
        component: "override",
        custom: "kept",
      },
      {
        component: "worker",
        event: "worker_stream",
        level: "info",
        req_id: "req-123",
      }
    );
    expect(entry.event).toBe("worker_stream");
    expect(entry.component).toBe("worker");
    expect(entry.level).toBe("info");
    expect(entry.req_id).toBe("req-123");
    expect(entry.custom).toBe("kept");
  });
});
