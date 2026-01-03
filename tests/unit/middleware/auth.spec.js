import { afterEach, describe, expect, it, vi } from "vitest";

const isLoopbackRequestMock = vi.fn();

vi.mock("../../../src/lib/net.js", () => ({
  isLoopbackRequest: (...args) => isLoopbackRequestMock(...args),
}));

const originalEnv = {
  PROXY_API_KEY: process.env.PROXY_API_KEY,
  PROXY_USAGE_ALLOW_UNAUTH: process.env.PROXY_USAGE_ALLOW_UNAUTH,
  PROXY_TEST_ALLOW_REMOTE: process.env.PROXY_TEST_ALLOW_REMOTE,
};

const resetEnv = () => {
  if (originalEnv.PROXY_API_KEY === undefined) {
    delete process.env.PROXY_API_KEY;
  } else {
    process.env.PROXY_API_KEY = originalEnv.PROXY_API_KEY;
  }
  if (originalEnv.PROXY_USAGE_ALLOW_UNAUTH === undefined) {
    delete process.env.PROXY_USAGE_ALLOW_UNAUTH;
  } else {
    process.env.PROXY_USAGE_ALLOW_UNAUTH = originalEnv.PROXY_USAGE_ALLOW_UNAUTH;
  }
  if (originalEnv.PROXY_TEST_ALLOW_REMOTE === undefined) {
    delete process.env.PROXY_TEST_ALLOW_REMOTE;
  } else {
    process.env.PROXY_TEST_ALLOW_REMOTE = originalEnv.PROXY_TEST_ALLOW_REMOTE;
  }
};

const createRes = () => ({
  headers: new Map(),
  statusCode: null,
  status: vi.fn(function status(code) {
    this.statusCode = code;
    return this;
  }),
  set: vi.fn(function set(key, value) {
    this.headers.set(key, value);
    return this;
  }),
  json: vi.fn(function json(body) {
    this.body = body;
    return this;
  }),
});

afterEach(() => {
  resetEnv();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("auth middleware", () => {
  it("rejects missing auth in requireStrictAuth", async () => {
    process.env.PROXY_API_KEY = "secret";
    vi.resetModules();
    const { requireStrictAuth } = await import("../../../src/middleware/auth.js");
    const req = { headers: {} };
    const res = createRes();
    const next = vi.fn();

    requireStrictAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.headers.get("WWW-Authenticate")).toBe("Bearer realm=api");
    expect(res.body).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          type: "authentication_error",
          code: "invalid_api_key",
        }),
      })
    );
  });

  it("allows valid auth in requireStrictAuth", async () => {
    process.env.PROXY_API_KEY = "secret";
    vi.resetModules();
    const { requireStrictAuth } = await import("../../../src/middleware/auth.js");
    const req = { headers: { authorization: "Bearer secret" } };
    const res = createRes();
    const next = vi.fn();

    requireStrictAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("allows usage requests when PROXY_USAGE_ALLOW_UNAUTH is true", async () => {
    process.env.PROXY_USAGE_ALLOW_UNAUTH = "true";
    vi.resetModules();
    const { requireUsageAuth } = await import("../../../src/middleware/auth.js");
    const req = { headers: {} };
    const res = createRes();
    const next = vi.fn();

    requireUsageAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("blocks non-loopback test access when remote is disabled", async () => {
    process.env.PROXY_API_KEY = "secret";
    process.env.PROXY_TEST_ALLOW_REMOTE = "false";
    isLoopbackRequestMock.mockReturnValue(false);
    vi.resetModules();
    const { requireTestAuth } = await import("../../../src/middleware/auth.js");
    const req = { headers: { authorization: "Bearer secret" } };
    const res = createRes();
    const next = vi.fn();

    requireTestAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body).toEqual({ ok: false, reason: "test endpoints restricted to loopback" });
    expect(isLoopbackRequestMock).toHaveBeenCalled();
  });

  it("allows test access when loopback and auth are valid", async () => {
    process.env.PROXY_API_KEY = "secret";
    process.env.PROXY_TEST_ALLOW_REMOTE = "false";
    isLoopbackRequestMock.mockReturnValue(true);
    vi.resetModules();
    const { requireTestAuth } = await import("../../../src/middleware/auth.js");
    const req = { headers: { authorization: "Bearer secret" } };
    const res = createRes();
    const next = vi.fn();

    requireTestAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
