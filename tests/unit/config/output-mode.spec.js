import { afterEach, describe, expect, it, vi } from "vitest";

const original = process.env.PROXY_OUTPUT_MODE;
const originalCopilotAuto = process.env.PROXY_COPILOT_AUTO_DETECT;

afterEach(() => {
  if (original === undefined) {
    delete process.env.PROXY_OUTPUT_MODE;
  } else {
    process.env.PROXY_OUTPUT_MODE = original;
  }
  if (originalCopilotAuto === undefined) {
    delete process.env.PROXY_COPILOT_AUTO_DETECT;
  } else {
    process.env.PROXY_COPILOT_AUTO_DETECT = originalCopilotAuto;
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

  it("defaults copilot auto-detect to false", async () => {
    delete process.env.PROXY_COPILOT_AUTO_DETECT;
    vi.resetModules();
    const { config } = await import("../../../src/config/index.js");
    expect(config.PROXY_COPILOT_AUTO_DETECT).toBe(false);
  });

  it("enables copilot auto-detect when set", async () => {
    process.env.PROXY_COPILOT_AUTO_DETECT = "true";
    vi.resetModules();
    const { config } = await import("../../../src/config/index.js");
    expect(config.PROXY_COPILOT_AUTO_DETECT).toBe(true);
  });
});
