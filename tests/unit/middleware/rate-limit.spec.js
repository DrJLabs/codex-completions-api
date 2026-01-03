import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getClientIpMock = vi.fn();

vi.mock("../../../src/lib/net.js", () => ({
  getClientIp: (...args) => getClientIpMock(...args),
}));

const buildReq = (overrides = {}) => ({
  method: "POST",
  path: "/v1/chat/completions",
  headers: {},
  ...overrides,
});

const buildRes = () => {
  const res = {
    setHeader: vi.fn(),
    status: vi.fn(() => res),
    json: vi.fn(),
  };
  return res;
};

const loadRateLimit = async () => {
  vi.resetModules();
  return (await import("../../../src/middleware/rate-limit.js")).default;
};

beforeEach(() => {
  getClientIpMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("rateLimit middleware", () => {
  it("passes through when disabled", async () => {
    const rateLimit = await loadRateLimit();
    const middleware = rateLimit({ enabled: "false" });
    const req = buildReq();
    const res = buildRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("passes through for non-POST requests", async () => {
    const rateLimit = await loadRateLimit();
    const middleware = rateLimit({ enabled: "true" });
    const req = buildReq({ method: "GET" });
    const res = buildRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("passes through for unguarded paths", async () => {
    const rateLimit = await loadRateLimit();
    const middleware = rateLimit({ enabled: "true" });
    const req = buildReq({ path: "/health" });
    const res = buildRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("enforces limits by bearer token and sets Retry-After", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const rateLimit = await loadRateLimit();
    const middleware = rateLimit({ enabled: "true", windowMs: 1000, max: 2 });
    const req = buildReq({ headers: { authorization: "Bearer token-1" } });
    const res = buildRes();
    const next = vi.fn();

    middleware(req, res, next);
    middleware(req, res, next);
    middleware(req, res, next);

    expect(getClientIpMock).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(2);
    expect(res.setHeader).toHaveBeenCalledWith("Retry-After", 1);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        message: "rate limit exceeded",
        type: "rate_limit_error",
        code: "rate_limited",
      },
    });
  });

  it("falls back to IP and resets after the window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    getClientIpMock.mockReturnValue("10.0.0.1");

    const rateLimit = await loadRateLimit();
    const middleware = rateLimit({ enabled: "true", windowMs: 1000, max: 1 });
    const req = buildReq({ path: undefined, originalUrl: "/v1/responses" });
    const res = buildRes();
    const next = vi.fn();

    middleware(req, res, next);

    vi.setSystemTime(1001);
    middleware(req, res, next);

    expect(getClientIpMock).toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(2);
    expect(res.status).not.toHaveBeenCalled();
  });
});
