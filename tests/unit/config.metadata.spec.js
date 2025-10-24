import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("config metadata sanitizer toggle", () => {
  const original = process.env.PROXY_SANITIZE_METADATA;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.PROXY_SANITIZE_METADATA;
    } else {
      process.env.PROXY_SANITIZE_METADATA = original;
    }
    vi.resetModules();
  });

  it("defaults to false when unset", async () => {
    delete process.env.PROXY_SANITIZE_METADATA;
    const { config } = await import("../../src/config/index.js");
    expect(config.PROXY_SANITIZE_METADATA).toBe(false);
  });

  it("coerces true string to boolean", async () => {
    process.env.PROXY_SANITIZE_METADATA = "true";
    const { config } = await import("../../src/config/index.js");
    expect(config.PROXY_SANITIZE_METADATA).toBe(true);
  });
});
