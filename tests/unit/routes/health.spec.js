import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const selectBackendModeMock = vi.hoisted(() => vi.fn());
const getWorkerStatusMock = vi.hoisted(() => vi.fn());
const configMock = vi.hoisted(() => ({
  PROXY_SANDBOX_MODE: "read-only",
}));

vi.mock("../../../src/config/index.js", () => ({
  config: configMock,
}));

vi.mock("../../../src/services/backend-mode.js", () => ({
  BACKEND_APP_SERVER: "app-server",
  selectBackendMode: (...args) => selectBackendModeMock(...args),
}));

vi.mock("../../../src/services/worker/supervisor.js", () => ({
  getWorkerStatus: (...args) => getWorkerStatusMock(...args),
}));

const startServer = async () => {
  const { default: healthRouter } = await import("../../../src/routes/health.js");
  const app = express();
  app.use(healthRouter());
  const server = app.listen(0);
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
};

beforeEach(() => {
  selectBackendModeMock.mockReset();
  getWorkerStatusMock.mockReset().mockReturnValue({
    health: {
      readiness: { ready: false },
      liveness: { live: false },
    },
  });
});

afterEach(() => {
  vi.resetModules();
});

describe("health routes", () => {
  it("returns unhealthy when app-server mode is disabled", async () => {
    selectBackendModeMock.mockReturnValue("local");
    const { server, baseUrl } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/healthz`);
      const payload = await res.json();
      expect(payload.ok).toBe(false);
      expect(payload.app_server_enabled).toBe(false);
      expect(payload.health.readiness.reason).toBe("app_server_disabled");
    } finally {
      server.close();
    }
  });

  it("returns 503 for readyz and livez when app-server disabled", async () => {
    selectBackendModeMock.mockReturnValue("local");
    const { server, baseUrl } = await startServer();
    try {
      const ready = await fetch(`${baseUrl}/readyz`);
      expect(ready.status).toBe(503);
      const readyPayload = await ready.json();
      expect(readyPayload.app_server_enabled).toBe(false);

      const live = await fetch(`${baseUrl}/livez`);
      expect(live.status).toBe(503);
      const livePayload = await live.json();
      expect(livePayload.app_server_enabled).toBe(false);
    } finally {
      server.close();
    }
  });

  it("returns healthy when app-server is ready and live", async () => {
    selectBackendModeMock.mockReturnValue("app-server");
    getWorkerStatusMock.mockReturnValue({
      health: {
        readiness: { ready: true },
        liveness: { live: true },
      },
    });
    const { server, baseUrl } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/healthz`);
      const payload = await res.json();
      expect(payload.ok).toBe(true);
      expect(payload.app_server_enabled).toBe(true);
    } finally {
      server.close();
    }
  });

  it("returns 503 when readiness or liveness checks fail", async () => {
    selectBackendModeMock.mockReturnValue("app-server");
    getWorkerStatusMock.mockReturnValue({
      health: {
        readiness: { ready: false, reason: "booting" },
        liveness: { live: false, reason: "booting" },
      },
    });
    const { server, baseUrl } = await startServer();
    try {
      const ready = await fetch(`${baseUrl}/readyz`);
      const readyPayload = await ready.json();
      expect(ready.status).toBe(503);
      expect(readyPayload.ok).toBe(false);

      const live = await fetch(`${baseUrl}/livez`);
      const livePayload = await live.json();
      expect(live.status).toBe(503);
      expect(livePayload.ok).toBe(false);
    } finally {
      server.close();
    }
  });
});
