import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

const guardSnapshotMock = vi.fn(() => 2);
const getWorkerStatusMock = vi.fn(() => ({ ready: true }));
const renderMetricsMock = vi.fn(async () => "metrics-body");
const setActiveStreamsMock = vi.fn();
const setMaintenanceStateMock = vi.fn();
const setWorkerMetricsMock = vi.fn();
const observeWorkerRestartDeltaMock = vi.fn();

vi.mock("../../src/services/concurrency-guard.js", () => ({
  guardSnapshot: () => guardSnapshotMock(),
}));

vi.mock("../../src/services/worker/supervisor.js", () => ({
  getWorkerStatus: () => getWorkerStatusMock(),
}));

vi.mock("../../src/services/metrics/index.js", () => ({
  renderMetrics: () => renderMetricsMock(),
  setActiveStreams: (...args) => setActiveStreamsMock(...args),
  setMaintenanceState: (...args) => setMaintenanceStateMock(...args),
  setWorkerMetrics: (...args) => setWorkerMetricsMock(...args),
  observeWorkerRestartDelta: (...args) => observeWorkerRestartDeltaMock(...args),
}));

const originalEnv = {
  PROXY_METRICS_ALLOW_UNAUTH: process.env.PROXY_METRICS_ALLOW_UNAUTH,
  PROXY_METRICS_ALLOW_LOOPBACK: process.env.PROXY_METRICS_ALLOW_LOOPBACK,
  PROXY_METRICS_TOKEN: process.env.PROXY_METRICS_TOKEN,
  PROXY_MAINTENANCE_MODE: process.env.PROXY_MAINTENANCE_MODE,
};

const resetEnv = () => {
  if (originalEnv.PROXY_METRICS_ALLOW_UNAUTH === undefined) {
    delete process.env.PROXY_METRICS_ALLOW_UNAUTH;
  } else {
    process.env.PROXY_METRICS_ALLOW_UNAUTH = originalEnv.PROXY_METRICS_ALLOW_UNAUTH;
  }
  if (originalEnv.PROXY_METRICS_ALLOW_LOOPBACK === undefined) {
    delete process.env.PROXY_METRICS_ALLOW_LOOPBACK;
  } else {
    process.env.PROXY_METRICS_ALLOW_LOOPBACK = originalEnv.PROXY_METRICS_ALLOW_LOOPBACK;
  }
  if (originalEnv.PROXY_METRICS_TOKEN === undefined) {
    delete process.env.PROXY_METRICS_TOKEN;
  } else {
    process.env.PROXY_METRICS_TOKEN = originalEnv.PROXY_METRICS_TOKEN;
  }
  if (originalEnv.PROXY_MAINTENANCE_MODE === undefined) {
    delete process.env.PROXY_MAINTENANCE_MODE;
  } else {
    process.env.PROXY_MAINTENANCE_MODE = originalEnv.PROXY_MAINTENANCE_MODE;
  }
};

const startApp = async () => {
  const { default: metricsRouter } = await import("../../src/routes/metrics.js");
  const app = express();
  app.use(metricsRouter());
  const server = app.listen(0);
  const port = server.address().port;
  return { server, port };
};

beforeEach(() => {
  guardSnapshotMock.mockReset().mockReturnValue(2);
  getWorkerStatusMock.mockReset().mockReturnValue({ ready: true });
  renderMetricsMock.mockReset().mockResolvedValue("metrics-body");
  setActiveStreamsMock.mockReset();
  setMaintenanceStateMock.mockReset();
  setWorkerMetricsMock.mockReset();
  observeWorkerRestartDeltaMock.mockReset();
});

afterEach(() => {
  resetEnv();
  vi.resetModules();
});

describe("metrics router", () => {
  it("returns 403 when access is denied", async () => {
    process.env.PROXY_METRICS_ALLOW_UNAUTH = "false";
    process.env.PROXY_METRICS_ALLOW_LOOPBACK = "false";
    process.env.PROXY_METRICS_TOKEN = "secret";
    renderMetricsMock.mockResolvedValue("metrics-body");
    vi.resetModules();

    const { server, port } = await startApp();
    const res = await fetch(`http://127.0.0.1:${port}/metrics`);
    const body = await res.json();
    server.close();

    expect(res.status).toBe(403);
    expect(body).toEqual({ ok: false, reason: "metrics access denied" });
    expect(renderMetricsMock).not.toHaveBeenCalled();
  });

  it("allows bearer token access", async () => {
    process.env.PROXY_METRICS_ALLOW_UNAUTH = "false";
    process.env.PROXY_METRICS_ALLOW_LOOPBACK = "false";
    process.env.PROXY_METRICS_TOKEN = "secret";
    process.env.PROXY_MAINTENANCE_MODE = "true";
    const workerStatus = { ready: true };
    getWorkerStatusMock.mockReturnValue(workerStatus);
    renderMetricsMock.mockResolvedValue("metrics-body");
    vi.resetModules();

    const { server, port } = await startApp();
    const res = await fetch(`http://127.0.0.1:${port}/metrics`, {
      headers: { Authorization: "Bearer secret" },
    });
    const text = await res.text();
    server.close();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(text).toBe("metrics-body");
    expect(setActiveStreamsMock).toHaveBeenCalledWith(2);
    expect(setWorkerMetricsMock).toHaveBeenCalledWith(workerStatus);
    expect(observeWorkerRestartDeltaMock).toHaveBeenCalledWith(workerStatus);
    expect(setMaintenanceStateMock).toHaveBeenCalledWith(true);
  });

  it("allows loopback access when enabled", async () => {
    process.env.PROXY_METRICS_ALLOW_UNAUTH = "false";
    process.env.PROXY_METRICS_ALLOW_LOOPBACK = "true";
    process.env.PROXY_METRICS_TOKEN = "";
    renderMetricsMock.mockResolvedValue("metrics-body");
    vi.resetModules();

    const { server, port } = await startApp();
    const res = await fetch(`http://127.0.0.1:${port}/metrics`);
    const text = await res.text();
    server.close();

    expect(res.status).toBe(200);
    expect(text).toBe("metrics-body");
  });
});
