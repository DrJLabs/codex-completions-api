import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

const resetToolEnv = () => {
  delete process.env.PROXY_TOOL_BLOCK_MAX;
  delete process.env.PROXY_STOP_AFTER_TOOLS;
  delete process.env.PROXY_STOP_AFTER_TOOLS_MODE;
  delete process.env.PROXY_SUPPRESS_TAIL_AFTER_TOOLS;
  delete process.env.PROXY_TOOL_BLOCK_DEDUP;
  delete process.env.PROXY_TOOL_BLOCK_DELIMITER;
  delete process.env.PROXY_ENABLE_PARALLEL_TOOL_CALLS;
};

describe("config tool-call controls", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
    resetToolEnv();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  test("exposes safe defaults", async () => {
    const { config } = await import("../../../src/config/index.js");
    expect(config.PROXY_TOOL_BLOCK_MAX).toBe(0);
    expect(config.PROXY_STOP_AFTER_TOOLS).toBe(false);
    expect(config.PROXY_STOP_AFTER_TOOLS_MODE).toBe("burst");
    expect(config.PROXY_SUPPRESS_TAIL_AFTER_TOOLS).toBe(false);
    expect(config.PROXY_TOOL_BLOCK_DEDUP).toBe(false);
    expect(config.PROXY_TOOL_BLOCK_DELIMITER).toBe("");
    expect(config.PROXY_ENABLE_PARALLEL_TOOL_CALLS).toBe(false);
  });

  test("honors explicit overrides", async () => {
    process.env.PROXY_TOOL_BLOCK_MAX = "2";
    process.env.PROXY_STOP_AFTER_TOOLS = "true";
    process.env.PROXY_STOP_AFTER_TOOLS_MODE = "FIRST";
    process.env.PROXY_SUPPRESS_TAIL_AFTER_TOOLS = "TrUe";
    process.env.PROXY_TOOL_BLOCK_DEDUP = "true";
    process.env.PROXY_TOOL_BLOCK_DELIMITER = ";;";
    process.env.PROXY_ENABLE_PARALLEL_TOOL_CALLS = "true";

    const { config } = await import("../../../src/config/index.js");
    expect(config.PROXY_TOOL_BLOCK_MAX).toBe(2);
    expect(config.PROXY_STOP_AFTER_TOOLS).toBe(true);
    expect(config.PROXY_STOP_AFTER_TOOLS_MODE).toBe("first");
    expect(config.PROXY_SUPPRESS_TAIL_AFTER_TOOLS).toBe(true);
    expect(config.PROXY_TOOL_BLOCK_DEDUP).toBe(true);
    expect(config.PROXY_TOOL_BLOCK_DELIMITER).toBe(";;");
    expect(config.PROXY_ENABLE_PARALLEL_TOOL_CALLS).toBe(true);
  });

  test("maps delimiter helper flags", async () => {
    process.env.PROXY_TOOL_BLOCK_DELIMITER = "true";
    let mod = await import("../../../src/config/index.js");
    expect(mod.config.PROXY_TOOL_BLOCK_DELIMITER).toBe("\n\n");

    vi.resetModules();
    process.env.PROXY_TOOL_BLOCK_DELIMITER = "\\n---\\n";
    mod = await import("../../../src/config/index.js");
    expect(mod.config.PROXY_TOOL_BLOCK_DELIMITER).toBe("\n---\n");
  });
});
