import { describe, expect, it, vi } from "vitest";

describe("worker supervisor without initialization", () => {
  it("reports disabled status and readiness flags", async () => {
    vi.resetModules();
    const module = await import("../../src/services/worker/supervisor.js");

    const status = module.getWorkerStatus();

    expect(status.enabled).toBe(false);
    expect(status.running).toBe(false);
    expect(status.ready).toBe(false);
    expect(status.health.readiness.reason).toBe("supervisor_not_initialized");
    expect(module.isWorkerSupervisorReady()).toBe(false);
    expect(module.isWorkerSupervisorRunning()).toBe(false);
  });
});
