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
        if (this.exitCode == null) {
          this.exitCode = 0;
        }
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

let ensureWorkerSupervisor;
let getWorkerStatus;
let currentSupervisor;

const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(async () => {
  mockChildren.splice(0, mockChildren.length);
  spawnCodexSpy.mockClear();
  vi.resetModules();
  process.env.PROXY_USE_APP_SERVER = "true";
  process.env.WORKER_BACKOFF_INITIAL_MS = "30";
  process.env.WORKER_BACKOFF_MAX_MS = "30";
  process.env.WORKER_RESTART_MAX = "3";

  const module = await import("../../src/services/worker/supervisor.js");
  ensureWorkerSupervisor = module.ensureWorkerSupervisor;
  getWorkerStatus = module.getWorkerStatus;
  currentSupervisor = ensureWorkerSupervisor();
  await settle();
});

afterEach(async () => {
  try {
    await currentSupervisor?.shutdown({ reason: "test_teardown" });
  } catch {}
  currentSupervisor = null;
  delete process.env.PROXY_USE_APP_SERVER;
  delete process.env.WORKER_BACKOFF_INITIAL_MS;
  delete process.env.WORKER_BACKOFF_MAX_MS;
  delete process.env.WORKER_RESTART_MAX;
  vi.clearAllMocks();
});

describe("CodexWorkerSupervisor health snapshots", () => {
  test("readiness toggles on handshake and exit events", async () => {
    expect(spawnCodexSpy).toHaveBeenCalledTimes(1);
    const initial = getWorkerStatus();
    expect(initial.readiness.ready).toBe(false);
    expect(initial.readiness.reason).toBe("worker_launching");
    expect(initial.liveness.live).toBe(true);
    expect(["worker_starting", "worker_running"]).toContain(initial.liveness.reason);

    const child = mockChildren[mockChildren.length - 1];
    child.stdout.write(`${JSON.stringify({ event: "ready", models: ["codex-5"] })}\n`);
    await settle();

    const afterReady = getWorkerStatus();
    expect(afterReady.readiness.ready).toBe(true);
    expect(afterReady.readiness.reason).toBe("handshake_complete");
    expect(afterReady.readiness.handshake?.models).toEqual(["codex-5"]);
    expect(afterReady.liveness.live).toBe(true);
    expect(afterReady.liveness.reason).toBe("worker_running");

    child.exitCode = 0;
    child.signalCode = null;
    child.emit("exit", 0, null);
    await settle(10);

    const afterExit = getWorkerStatus();
    expect(afterExit.readiness.ready).toBe(false);
    expect(afterExit.readiness.reason).toBe("worker_exit");
    expect(afterExit.readiness.details?.restarts_total).toBeGreaterThanOrEqual(1);
    expect(afterExit.liveness.live).toBe(true);
    expect(afterExit.liveness.reason).toBe("worker_restarting");

    // Restart should spawn a new child after backoff window passes
    await settle(45);
    expect(spawnCodexSpy).toHaveBeenCalledTimes(2);
  });
});
