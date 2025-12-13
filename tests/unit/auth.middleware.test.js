/* eslint-disable security/detect-object-injection */
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

const makeReq = (authorization) => ({
  headers: authorization ? { authorization } : {},
});

const makeRes = () => {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    set(key, value) {
      this.headers[key] = value;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  return res;
};

const withFreshAuth = async (env) => {
  vi.resetModules();
  Object.assign(process.env, env);
  return await import("../../src/middleware/auth.js");
};

describe("auth middleware", () => {
  const originalEnv = { ...process.env };

  const resetEnv = () => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  };

  beforeEach(resetEnv);
  afterEach(resetEnv);

  test("requireStrictAuth rejects missing auth even when usage allow-unauth enabled", async () => {
    const { requireStrictAuth } = await withFreshAuth({
      PROXY_API_KEY: "secret",
      PROXY_USAGE_ALLOW_UNAUTH: "true",
    });
    const req = makeReq(undefined);
    const res = makeRes();
    let nextCalled = false;
    requireStrictAuth(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.headers["WWW-Authenticate"]).toBe("Bearer realm=api");
    expect(res.body?.error?.type).toBe("authentication_error");
  });

  test("requireStrictAuth accepts lowercase bearer scheme and trims token", async () => {
    const { requireStrictAuth } = await withFreshAuth({
      PROXY_API_KEY: "secret",
      PROXY_USAGE_ALLOW_UNAUTH: "true",
    });
    const req = makeReq("bearer secret   ");
    const res = makeRes();
    let nextCalled = false;
    requireStrictAuth(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  test("requireUsageAuth bypasses auth when usage allow-unauth enabled", async () => {
    const { requireUsageAuth } = await withFreshAuth({
      PROXY_API_KEY: "secret",
      PROXY_USAGE_ALLOW_UNAUTH: "true",
    });
    const req = makeReq(undefined);
    const res = makeRes();
    let nextCalled = false;
    requireUsageAuth(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBe(200);
  });
});
