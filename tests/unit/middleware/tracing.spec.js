import { describe, expect, test, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

const startHttpSpanMock = vi.fn();
vi.mock("../../../src/services/tracing.js", () => ({
  startHttpSpan: (...args) => startHttpSpanMock(...args),
}));

const tracingMiddleware = (await import("../../../src/middleware/tracing.js")).default;

beforeEach(() => {
  startHttpSpanMock.mockReset();
});

describe("tracing middleware", () => {
  test("sets trace locals and ends span on finish", () => {
    const setAttribute = vi.fn();
    const end = vi.fn();
    startHttpSpanMock.mockReturnValue({
      span: {
        spanContext: () => ({ traceId: "trace-1", spanId: "span-1" }),
        setAttribute,
        end,
      },
      context: {},
    });

    const req = { method: "GET", route: { path: "/v1/health" } };
    const res = new EventEmitter();
    res.locals = {};
    res.statusCode = 201;
    const next = vi.fn();

    tracingMiddleware()(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.locals.trace_id).toBe("trace-1");
    expect(res.locals.span_id).toBe("span-1");
    expect(res.locals.trace_span).toBeDefined();

    res.emit("finish");
    expect(setAttribute).toHaveBeenCalledWith("http.status_code", 201);
    expect(end).toHaveBeenCalledTimes(1);
  });

  test("no-op when tracing disabled", () => {
    startHttpSpanMock.mockReturnValue(null);
    const req = { method: "GET", route: { path: "/v1/models" } };
    const res = new EventEmitter();
    res.locals = {};
    const next = vi.fn();

    tracingMiddleware()(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.locals.trace_id).toBeUndefined();
    res.emit("finish");
  });
});
