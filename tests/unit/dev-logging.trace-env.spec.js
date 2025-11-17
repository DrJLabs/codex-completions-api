import { describe, it, expect, vi, afterEach } from "vitest";

const resetEnv = () => {
  delete process.env.PROXY_ENV;
  delete process.env.PROXY_LOG_PROTO;
  delete process.env.PROXY_TRACE_REQUIRED;
};

describe("dev-logging environment gating", () => {
  afterEach(() => {
    vi.resetModules();
    resetEnv();
  });

  it("throws when tracing is required but proto logging disabled", async () => {
    process.env.PROXY_ENV = "dev";
    process.env.PROXY_TRACE_REQUIRED = "true";
    process.env.PROXY_LOG_PROTO = "false";
    await expect(import("../../src/dev-logging.js")).rejects.toThrow(/Tracing is required/);
  });

  it("allows disabling proto logs outside dev by default", async () => {
    process.env.PROXY_ENV = "prod";
    process.env.PROXY_LOG_PROTO = "false";
    const mod = await import("../../src/dev-logging.js");
    expect(mod.LOG_PROTO).toBe(false);
  });

  it("enables proto logging automatically in dev", async () => {
    process.env.PROXY_ENV = "dev";
    delete process.env.PROXY_LOG_PROTO;
    const mod = await import("../../src/dev-logging.js");
    expect(mod.LOG_PROTO).toBe(true);
  });
});
