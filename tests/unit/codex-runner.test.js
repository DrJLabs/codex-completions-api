/* eslint-disable security/detect-object-injection */
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

const spawnSpy = vi.fn(() => {
  const child = new EventEmitter();
  child.pid = 12345;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  return child;
});

vi.mock("node:child_process", () => ({
  spawn: spawnSpy,
}));

describe("spawnCodex", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
    spawnSpy.mockClear();
    vi.resetModules();
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  test("strips proxy secrets from child env and clamps unsafe spawn options", async () => {
    process.env.PROXY_API_KEY = "secret";
    process.env.PROXY_METRICS_TOKEN = "metrics-secret";

    const { spawnCodex } = await import("../../src/services/codex-runner.js");

    spawnCodex(["--version"], {
      env: { EXTRA: "1" },
      shell: true,
      stdio: "inherit",
    });

    expect(spawnSpy).toHaveBeenCalledTimes(1);
    const call = spawnSpy.mock.calls[0];
    const options = call[2];
    expect(options.shell).toBe(false);
    expect(options.stdio).toEqual(["pipe", "pipe", "pipe"]);
    expect(options.env.PROXY_API_KEY).toBeUndefined();
    expect(options.env.PROXY_METRICS_TOKEN).toBeUndefined();
    expect(options.env.EXTRA).toBe("1");
  });
});
