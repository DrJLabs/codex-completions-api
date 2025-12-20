import { describe, expect, test } from "vitest";
import { ensureCopilotTraceContext } from "../../../src/lib/trace-ids.js";

const makeReq = (headers = {}) => ({ headers });
const makeRes = (locals = {}) => ({ locals });

describe("copilot trace context", () => {
  test("prefers x-copilot-trace-id", () => {
    const req = makeReq({ "x-copilot-trace-id": "copilot-123" });
    const res = makeRes();
    const ctx = ensureCopilotTraceContext(req, res);
    expect(ctx).toMatchObject({
      id: "copilot-123",
      source: "header",
      header: "x-copilot-trace-id",
    });
    expect(res.locals.copilot_trace_id).toBe("copilot-123");
    expect(res.locals.copilot_trace_source).toBe("header");
    expect(res.locals.copilot_trace_header).toBe("x-copilot-trace-id");
  });

  test("falls back to x-trace-id then x-request-id", () => {
    const req = makeReq({ "x-trace-id": "trace-1", "x-request-id": "trace-2" });
    const res = makeRes();
    const ctx = ensureCopilotTraceContext(req, res);
    expect(ctx).toMatchObject({
      id: "trace-1",
      source: "header",
      header: "x-trace-id",
    });
  });

  test("falls back to x-request-id when others are absent", () => {
    const req = makeReq({ "x-request-id": "request-456" });
    const res = makeRes();
    const ctx = ensureCopilotTraceContext(req, res);
    expect(ctx).toMatchObject({
      id: "request-456",
      source: "header",
      header: "x-request-id",
    });
  });

  test("generates id when no headers", () => {
    const req = makeReq({});
    const res = makeRes();
    const ctx = ensureCopilotTraceContext(req, res);
    expect(ctx.source).toBe("generated");
    expect(ctx.header).toBe(null);
    expect(typeof ctx.id).toBe("string");
    expect(ctx.id.length).toBeGreaterThan(0);
  });

  test("trims and limits header value length", () => {
    const req = makeReq({ "x-copilot-trace-id": `  ${"x".repeat(400)}  ` });
    const res = makeRes();
    const ctx = ensureCopilotTraceContext(req, res);
    expect(ctx.id.length).toBe(256);
  });
});
