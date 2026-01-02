import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config as CFG } from "../../../src/config/index.js";

const { appendProtoEvent, sanitizeBody, ensureReqId, getHttpContext } = vi.hoisted(() => ({
  appendProtoEvent: vi.fn(),
  sanitizeBody: vi.fn((body) => body),
  ensureReqId: vi.fn(() => "req-123"),
  getHttpContext: vi.fn(() => ({ route: "/v1/test", mode: "test" })),
}));

vi.mock("../../../src/dev-logging.js", () => ({
  appendProtoEvent,
}));
vi.mock("../../../src/dev-trace/sanitize.js", () => ({
  sanitizeBody,
}));
vi.mock("../../../src/lib/request-context.js", () => ({
  ensureReqId,
  getHttpContext,
}));

import {
  computeKeepaliveMs,
  finishSSE,
  installJsonLogger,
  logJsonResponse,
  sendComment,
  setSSEHeaders,
  startKeepalives,
} from "../../../src/services/sse.js";

const buildRes = () => {
  const res = new EventEmitter();
  res.locals = {};
  res.statusCode = 200;
  res.write = vi.fn(() => true);
  res.flush = vi.fn();
  res.setHeader = vi.fn();
  res.flushHeaders = vi.fn();
  res.end = vi.fn();
  res.json = vi.fn((body) => body);
  return res;
};

afterEach(() => {
  appendProtoEvent.mockClear();
  sanitizeBody.mockClear();
  ensureReqId.mockClear();
  getHttpContext.mockClear();
});

describe("sse helpers", () => {
  it("sets standard SSE headers", () => {
    const res = buildRes();

    setSSEHeaders(res);

    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/event-stream");
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-cache, no-transform");
    expect(res.setHeader).toHaveBeenCalledWith("Connection", "keep-alive");
    expect(res.setHeader).toHaveBeenCalledWith("X-Accel-Buffering", "no");
    expect(res.flushHeaders).toHaveBeenCalled();
  });

  it("disables keepalives for flagged user agents", () => {
    const req = { headers: { "user-agent": "Obsidian" }, query: {} };

    expect(computeKeepaliveMs(req)).toBe(0);
  });

  it("disables keepalives via header or query", () => {
    const headerReq = { headers: { "x-no-keepalive": "1" }, query: {} };
    const queryReq = { headers: {}, query: { no_keepalive: "1" } };

    expect(computeKeepaliveMs(headerReq)).toBe(0);
    expect(computeKeepaliveMs(queryReq)).toBe(0);
  });

  it("returns default keepalive interval when enabled", () => {
    const req = { headers: {}, query: {} };

    expect(computeKeepaliveMs(req)).toBe(CFG.PROXY_SSE_KEEPALIVE_MS);
  });

  it("fires keepalives until stopped", () => {
    vi.useFakeTimers();
    const res = buildRes();
    const writer = vi.fn();

    const keepalive = startKeepalives(res, 1000, writer);
    vi.advanceTimersByTime(3100);

    expect(writer).toHaveBeenCalledTimes(3);

    keepalive.stop();
    vi.advanceTimersByTime(2000);
    expect(writer).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });

  it("sends comment frames", async () => {
    const res = buildRes();

    await sendComment(res, "hello");

    expect(res.write).toHaveBeenCalledWith(": hello\n\n");
  });

  it("logs and finishes SSE only once", async () => {
    const res = buildRes();

    finishSSE(res);
    finishSSE(res);
    await new Promise((resolve) => setImmediate(resolve));

    const doneLogs = appendProtoEvent.mock.calls.filter(
      ([event]) => event.kind === "client_sse_done"
    );
    expect(doneLogs).toHaveLength(1);
    expect(res.end).toHaveBeenCalled();
  });

  it("logs JSON responses and wraps res.json once", () => {
    const res = buildRes();
    res.statusCode = 202;
    const jsonSpy = res.json;

    logJsonResponse(res, { ok: true }, { statusCode: 201 });
    expect(appendProtoEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "client_json",
        status_code: 201,
        payload: { ok: true },
      })
    );

    appendProtoEvent.mockClear();
    installJsonLogger(res);
    installJsonLogger(res);
    res.json({ wrapped: true });

    expect(appendProtoEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "client_json",
        status_code: 202,
        payload: { wrapped: true },
      })
    );
    expect(jsonSpy).toHaveBeenCalledTimes(1);
  });
});
