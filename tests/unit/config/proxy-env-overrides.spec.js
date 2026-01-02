import { afterEach, describe, expect, it, vi } from "vitest";

const originalApproval = process.env.PROXY_APPROVAL_POLICY;
const originalCodexApproval = process.env.CODEX_APPROVAL_POLICY;
const originalGraceMs = process.env.PROXY_STOP_AFTER_TOOLS_GRACE_MS;
const originalAuthLoginUrlMode = process.env.PROXY_AUTH_LOGIN_URL_MODE;
const originalTrustProxy = process.env.PROXY_TRUST_PROXY;

afterEach(() => {
  if (originalApproval === undefined) {
    delete process.env.PROXY_APPROVAL_POLICY;
  } else {
    process.env.PROXY_APPROVAL_POLICY = originalApproval;
  }
  if (originalCodexApproval === undefined) {
    delete process.env.CODEX_APPROVAL_POLICY;
  } else {
    process.env.CODEX_APPROVAL_POLICY = originalCodexApproval;
  }
  if (originalGraceMs === undefined) {
    delete process.env.PROXY_STOP_AFTER_TOOLS_GRACE_MS;
  } else {
    process.env.PROXY_STOP_AFTER_TOOLS_GRACE_MS = originalGraceMs;
  }
  if (originalAuthLoginUrlMode === undefined) {
    delete process.env.PROXY_AUTH_LOGIN_URL_MODE;
  } else {
    process.env.PROXY_AUTH_LOGIN_URL_MODE = originalAuthLoginUrlMode;
  }
  if (originalTrustProxy === undefined) {
    delete process.env.PROXY_TRUST_PROXY;
  } else {
    process.env.PROXY_TRUST_PROXY = originalTrustProxy;
  }
  vi.resetModules();
});

describe("config approval policy", () => {
  it("defaults to never when unset", async () => {
    delete process.env.PROXY_APPROVAL_POLICY;
    delete process.env.CODEX_APPROVAL_POLICY;
    vi.resetModules();
    const { config } = await import("../../../src/config/index.js");
    expect(config.PROXY_APPROVAL_POLICY).toBe("never");
  });

  it("prefers PROXY_APPROVAL_POLICY over CODEX_APPROVAL_POLICY", async () => {
    process.env.PROXY_APPROVAL_POLICY = "Ask";
    process.env.CODEX_APPROVAL_POLICY = "always";
    vi.resetModules();
    const { config } = await import("../../../src/config/index.js");
    expect(config.PROXY_APPROVAL_POLICY).toBe("ask");
  });

  it("falls back to CODEX_APPROVAL_POLICY when proxy override is unset", async () => {
    delete process.env.PROXY_APPROVAL_POLICY;
    process.env.CODEX_APPROVAL_POLICY = "AUTO";
    vi.resetModules();
    const { config } = await import("../../../src/config/index.js");
    expect(config.PROXY_APPROVAL_POLICY).toBe("auto");
  });
});

describe("config stop-after-tools grace", () => {
  it("defaults to 300ms when unset", async () => {
    delete process.env.PROXY_STOP_AFTER_TOOLS_GRACE_MS;
    vi.resetModules();
    const { config } = await import("../../../src/config/index.js");
    expect(config.PROXY_STOP_AFTER_TOOLS_GRACE_MS).toBe(300);
  });

  it("accepts numeric overrides", async () => {
    process.env.PROXY_STOP_AFTER_TOOLS_GRACE_MS = "750";
    vi.resetModules();
    const { config } = await import("../../../src/config/index.js");
    expect(config.PROXY_STOP_AFTER_TOOLS_GRACE_MS).toBe(750);
  });

  it("falls back to default when override is invalid", async () => {
    process.env.PROXY_STOP_AFTER_TOOLS_GRACE_MS = "abc";
    vi.resetModules();
    const { config } = await import("../../../src/config/index.js");
    expect(config.PROXY_STOP_AFTER_TOOLS_GRACE_MS).toBe(300);
  });
});

describe("config auth login url mode", () => {
  it("normalizes allowed values", async () => {
    process.env.PROXY_AUTH_LOGIN_URL_MODE = "CODE+MESSAGE";
    vi.resetModules();
    const { config } = await import("../../../src/config/index.js");
    expect(config.PROXY_AUTH_LOGIN_URL_MODE).toBe("code+message");
  });

  it("falls back to empty string for invalid values", async () => {
    process.env.PROXY_AUTH_LOGIN_URL_MODE = "bogus";
    vi.resetModules();
    const { config } = await import("../../../src/config/index.js");
    expect(config.PROXY_AUTH_LOGIN_URL_MODE).toBe("");
  });
});

describe("config trust proxy", () => {
  it("defaults to loopback", async () => {
    delete process.env.PROXY_TRUST_PROXY;
    vi.resetModules();
    const { config } = await import("../../../src/config/index.js");
    expect(config.PROXY_TRUST_PROXY).toBe("loopback");
  });

  it("accepts explicit overrides", async () => {
    process.env.PROXY_TRUST_PROXY = "false";
    vi.resetModules();
    const { config } = await import("../../../src/config/index.js");
    expect(config.PROXY_TRUST_PROXY).toBe(false);
  });

  it("resolves boolean true values", async () => {
    process.env.PROXY_TRUST_PROXY = "true";
    vi.resetModules();
    const { config } = await import("../../../src/config/index.js");
    expect(config.PROXY_TRUST_PROXY).toBe(true);
  });
});
