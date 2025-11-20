import { afterEach, describe, expect, test, vi } from "vitest";
import express from "express";
import healthRouter from "../../src/routes/health.js";

const selectBackendMode = vi.fn(() => "app-server");
let mockStatus = {
  health: {
    readiness: { ready: true, reason: "handshake_complete", details: {} },
    liveness: { live: true, reason: "worker_running", details: {} },
  },
  restarts_total: 0,
  consecutive_failures: 0,
  next_restart_delay_ms: 0,
  last_exit: null,
  last_ready_at: null,
  startup_latency_ms: null,
  last_log_sample: null,
};

vi.mock("../../src/services/backend-mode.js", () => ({
  BACKEND_APP_SERVER: "app-server",
  selectBackendMode: () => selectBackendMode(),
}));

vi.mock("../../src/services/worker/supervisor.js", () => ({
  getWorkerStatus: () => mockStatus,
}));

const startApp = () => {
  const app = express();
  app.use(healthRouter());
  const server = app.listen(0);
  const port = server.address().port;
  return { server, port };
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("/readyz payload metadata", () => {
  test("includes restart/backoff details when app-server is enabled", async () => {
    selectBackendMode.mockReturnValue("app-server");
    mockStatus = {
      health: {
        readiness: { ready: true, reason: "handshake_complete", details: { extra: "keep" } },
        liveness: { live: true, reason: "worker_running", details: {} },
      },
      restarts_total: 2,
      consecutive_failures: 1,
      next_restart_delay_ms: 150,
      last_exit: { code: 1, at: "2025-11-20T00:00:00Z" },
      last_ready_at: "2025-11-20T00:00:00Z",
      startup_latency_ms: 42,
      last_log_sample: { stream: "stdout" },
    };

    const { server, port } = startApp();
    const res = await fetch(`http://127.0.0.1:${port}/readyz`);
    const body = await res.json();
    server.close();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.health.readiness.details.restarts_total).toBe(2);
    expect(body.health.readiness.details.next_restart_delay_ms).toBe(150);
    expect(body.health.readiness.details.last_exit).toEqual(mockStatus.last_exit);
    expect(body.health.readiness.details.startup_latency_ms).toBe(42);
    expect(body.health.readiness.details.last_log_sample).toEqual(mockStatus.last_log_sample);
    expect(body.health.readiness.details.extra).toBe("keep");
  });

  test("returns default metadata when app-server is disabled", async () => {
    selectBackendMode.mockReturnValue("proto");
    mockStatus = {
      health: {
        readiness: { ready: false, reason: "worker_not_started" },
        liveness: { live: false, reason: "worker_not_started" },
      },
      restarts_total: 5, // should be ignored when app-server disabled
    };

    const { server, port } = startApp();
    const res = await fetch(`http://127.0.0.1:${port}/readyz`);
    const body = await res.json();
    server.close();

    expect(res.status).toBe(200);
    expect(body.app_server_enabled).toBe(false);
    expect(body.health.readiness.details.restarts_total).toBe(0);
    expect(body.health.readiness.details.next_restart_delay_ms).toBe(0);
  });
});
