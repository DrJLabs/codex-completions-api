import { afterEach, describe, expect, it, vi } from "vitest";

const original = process.env.PROXY_OUTPUT_MODE;

afterEach(() => {
  if (original === undefined) {
    delete process.env.PROXY_OUTPUT_MODE;
  } else {
    process.env.PROXY_OUTPUT_MODE = original;
  }
  vi.resetModules();
});

describe("output mode configuration", () => {
  it("defaults to obsidian-xml when unset", async () => {
    delete process.env.PROXY_OUTPUT_MODE;
    vi.resetModules();
    const { config } = await import("../../../src/config/index.js");
    expect(config.PROXY_OUTPUT_MODE).toBe("obsidian-xml");
  });

  it("normalizes env override to lowercase", async () => {
    process.env.PROXY_OUTPUT_MODE = "OPENAI-JSON";
    vi.resetModules();
    const { config } = await import("../../../src/config/index.js");
    expect(config.PROXY_OUTPUT_MODE).toBe("openai-json");
  });
});
