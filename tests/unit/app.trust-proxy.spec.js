import { afterEach, describe, expect, it, vi } from "vitest";

const originalTrustProxy = process.env.PROXY_TRUST_PROXY;

afterEach(() => {
  if (originalTrustProxy === undefined) {
    delete process.env.PROXY_TRUST_PROXY;
  } else {
    process.env.PROXY_TRUST_PROXY = originalTrustProxy;
  }
  vi.resetModules();
});

describe("createApp trust proxy", () => {
  it("defaults to loopback", async () => {
    delete process.env.PROXY_TRUST_PROXY;
    vi.resetModules();
    const { default: createApp } = await import("../../src/app.js");
    const app = createApp();
    expect(app.get("trust proxy")).toBe("loopback");
  });

  it("disables trust proxy when explicitly false", async () => {
    process.env.PROXY_TRUST_PROXY = "false";
    vi.resetModules();
    const { default: createApp } = await import("../../src/app.js");
    const app = createApp();
    expect(app.get("trust proxy")).toBe(false);
  });
});
