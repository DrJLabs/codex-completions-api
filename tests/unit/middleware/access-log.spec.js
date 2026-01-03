import { describe, expect, it, vi, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import accessLog from "../../../src/middleware/access-log.js";

const logStructuredMock = vi.fn();
const ensureCopilotTraceContextMock = vi.fn();
const detectCopilotRequestMock = vi.fn();

vi.mock("../../../src/services/logging/schema.js", () => ({
  logStructured: (...args) => logStructuredMock(...args),
}));

vi.mock("../../../src/lib/trace-ids.js", () => ({
  ensureCopilotTraceContext: (...args) => ensureCopilotTraceContextMock(...args),
}));

vi.mock("../../../src/lib/copilot-detect.js", () => ({
  detectCopilotRequest: (...args) => detectCopilotRequestMock(...args),
}));

const createRes = () => {
  const res = new EventEmitter();
  res.locals = {};
  res.statusCode = 200;
  res.setHeader = vi.fn();
  return res;
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("access log middleware", () => {
  it("logs structured access metadata on finish", () => {
    ensureCopilotTraceContextMock.mockReturnValue({
      id: "copilot-1",
      source: "header",
      header: "x-copilot-trace",
    });
    detectCopilotRequestMock.mockReturnValue({
      copilot_detected: true,
      copilot_detect_tier: "pro",
      copilot_detect_reasons: ["header"],
    });

    const req = {
      headers: {
        authorization: "Bearer token",
        "user-agent": "test-agent",
      },
      originalUrl: "/v1/chat",
      method: "POST",
    };
    const res = createRes();
    const next = vi.fn();

    accessLog()(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith("X-Request-Id", expect.any(String));

    res.emit("finish");

    expect(logStructuredMock).toHaveBeenCalled();
    const [canonical, extras] = logStructuredMock.mock.calls[0];
    expect(canonical).toEqual(
      expect.objectContaining({
        component: "http",
        event: "access_log",
        route: "/v1/chat",
        level: "info",
      })
    );
    expect(extras).toEqual(
      expect.objectContaining({
        method: "POST",
        status: 200,
        ua: "test-agent",
        auth: "present",
        kind: "access",
        copilot_trace_id: "copilot-1",
        copilot_trace_source: "header",
        copilot_trace_header: "x-copilot-trace",
        copilot_detected: true,
        copilot_detect_tier: "pro",
        copilot_detect_reasons: ["header"],
      })
    );
  });

  it("logs access_log_error if access logging fails", () => {
    ensureCopilotTraceContextMock.mockReturnValue({ id: null, source: null, header: null });
    detectCopilotRequestMock.mockReturnValue({
      copilot_detected: false,
      copilot_detect_tier: null,
      copilot_detect_reasons: [],
    });
    logStructuredMock
      .mockImplementationOnce(() => {
        throw new Error("boom");
      })
      .mockImplementation(() => ({}));

    const req = { headers: {}, originalUrl: "/healthz", method: "GET" };
    const res = createRes();
    const next = vi.fn();

    accessLog()(req, res, next);
    res.emit("finish");

    expect(logStructuredMock).toHaveBeenCalledTimes(2);
    const [canonical] = logStructuredMock.mock.calls[1];
    expect(canonical).toEqual(
      expect.objectContaining({
        component: "http",
        event: "access_log_error",
        level: "error",
      })
    );
  });
});
