/* eslint-disable security/detect-object-injection */
import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

const mockChildren = [];

class MockChild extends EventEmitter {
  constructor(pid) {
    super();
    this.pid = pid;
    this.stdout = new PassThrough({ encoding: "utf8" });
    this.stderr = new PassThrough({ encoding: "utf8" });
    this.exitCode = null;
    this.signalCode = null;
    this.kill = vi.fn((signal = "SIGTERM") => {
      this.signalCode = signal;
      setImmediate(() => {
        if (this.exitCode == null) this.exitCode = 0;
        this.emit("exit", this.exitCode, signal);
      });
    });
  }
}

const spawnCodexSpy = vi.fn(() => {
  const child = new MockChild(1000 + mockChildren.length);
  mockChildren.push(child);
  setImmediate(() => {
    child.emit("spawn");
  });
  return child;
});

vi.mock("../../src/services/codex-runner.js", () => ({
  spawnCodex: spawnCodexSpy,
}));

const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

describe("CodexWorkerSupervisor hardening", () => {
  const originalEnv = { ...process.env };

  const resetEnv = () => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  };

  beforeEach(() => {
    resetEnv();
    mockChildren.splice(0, mockChildren.length);
    spawnCodexSpy.mockClear();
    vi.resetModules();
  });

  afterEach(() => {
    resetEnv();
  });

  test("quote escapes backslashes, quotes, and control characters", async () => {
    process.env.PROXY_USE_APP_SERVER = "true";
    process.env.WORKER_BACKOFF_INITIAL_MS = "30";
    process.env.WORKER_BACKOFF_MAX_MS = "30";
    process.env.WORKER_RESTART_MAX = "1";
    process.env.WORKER_STARTUP_TIMEOUT_MS = "200";
    process.env.CODEX_MODEL = `a"b\\c\n\ttest`;

    const { ensureWorkerSupervisor } = await import("../../src/services/worker/supervisor.js");
    const supervisor = ensureWorkerSupervisor();
    await settle();

    expect(spawnCodexSpy).toHaveBeenCalledTimes(1);
    const launchArgs = spawnCodexSpy.mock.calls[0][0];
    const modelConfig = launchArgs.find(
      (arg) => typeof arg === "string" && arg.startsWith("model=")
    );
    expect(modelConfig).toBeTruthy();
    expect(modelConfig).toContain('\\"');
    expect(modelConfig).toContain("\\\\");
    expect(modelConfig).toContain("\\n");
    expect(modelConfig).toContain("\\t");
    expect(modelConfig).not.toContain("\n");
    expect(modelConfig).not.toContain("\t");

    // Resolve the ready watcher quickly to avoid dangling timers.
    const child = mockChildren[0];
    child.stdout.write(`${JSON.stringify({ event: "ready" })}\n`);
    await settle(60);

    await supervisor.shutdown({ reason: "test_teardown" });
  });

  test("readiness timeout kills and restarts worker", async () => {
    process.env.PROXY_USE_APP_SERVER = "true";
    process.env.WORKER_STARTUP_TIMEOUT_MS = "10";
    process.env.WORKER_BACKOFF_INITIAL_MS = "10";
    process.env.WORKER_BACKOFF_MAX_MS = "10";
    process.env.WORKER_RESTART_MAX = "1";

    const { ensureWorkerSupervisor } = await import("../../src/services/worker/supervisor.js");
    const supervisor = ensureWorkerSupervisor();

    await settle(120);

    expect(spawnCodexSpy).toHaveBeenCalledTimes(2);
    expect(mockChildren[0].kill).toHaveBeenCalled();

    await supervisor.shutdown({ reason: "test_teardown" });
  });
});
