import { describe, expect, it, vi, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import metricsMiddleware from "../../../src/middleware/metrics.js";

const observeHttpRequestMock = vi.fn();

vi.mock("../../../src/services/metrics/index.js", () => ({
  observeHttpRequest: (...args) => observeHttpRequestMock(...args),
}));

const createRes = () => {
  const res = new EventEmitter();
  res.statusCode = 200;
  return res;
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("metrics middleware", () => {
  it("reports route, model, method, and status", () => {
    const req = {
      method: "POST",
      route: { path: "/v1/chat" },
      body: { model: "gpt-5" },
      query: { model: "ignored" },
      originalUrl: "/v1/chat",
    };
    const res = createRes();
    res.statusCode = 201;
    const next = vi.fn();

    metricsMiddleware()(req, res, next);
    res.emit("finish");

    expect(next).toHaveBeenCalled();
    expect(observeHttpRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        route: "/v1/chat",
        method: "POST",
        statusCode: 201,
        model: "gpt-5",
      })
    );
  });

  it("falls back to query model and baseUrl", () => {
    const req = {
      method: "GET",
      baseUrl: "/v1/models",
      query: { model: "gpt-4" },
      originalUrl: "/v1/models",
    };
    const res = createRes();
    const next = vi.fn();

    metricsMiddleware()(req, res, next);
    res.emit("finish");

    expect(observeHttpRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        route: "/v1/models",
        method: "GET",
        statusCode: 200,
        model: "gpt-4",
      })
    );
  });

  it("uses originalUrl when route data is missing", () => {
    const req = {
      method: "GET",
      originalUrl: "/healthz",
    };
    const res = createRes();
    const next = vi.fn();

    metricsMiddleware()(req, res, next);
    res.emit("finish");

    expect(observeHttpRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        route: "/healthz",
        method: "GET",
        statusCode: 200,
        model: undefined,
      })
    );
  });
});
