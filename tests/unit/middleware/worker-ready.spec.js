import { describe, expect, test, vi, beforeEach } from "vitest";

const selectBackendModeMock = vi.fn();
const isWorkerSupervisorReadyMock = vi.fn();
const getWorkerStatusMock = vi.fn();
const applyCorsMock = vi.fn();

vi.mock("../../../src/services/backend-mode.js", () => ({
  selectBackendMode: () => selectBackendModeMock(),
  BACKEND_APP_SERVER: "app-server",
}));

vi.mock("../../../src/services/worker/supervisor.js", () => ({
  isWorkerSupervisorReady: () => isWorkerSupervisorReadyMock(),
  getWorkerStatus: () => getWorkerStatusMock(),
}));

vi.mock("../../../src/utils.js", () => ({
  applyCors: (...args) => applyCorsMock(...args),
}));

const { requireWorkerReady } = await import("../../../src/middleware/worker-ready.js");

const createRes = () => ({
  status: vi.fn(function status(code) {
    this.statusCode = code;
    return this;
  }),
  json: vi.fn(),
});

describe("requireWorkerReady", () => {
  beforeEach(() => {
    selectBackendModeMock.mockReset();
    isWorkerSupervisorReadyMock.mockReset();
    getWorkerStatusMock.mockReset();
    applyCorsMock.mockReset();
  });

  test("passes through for non-app-server backends", () => {
    selectBackendModeMock.mockReturnValue("proto");
    const req = {};
    const res = createRes();
    const next = vi.fn();

    requireWorkerReady(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test("passes through when supervisor is ready", () => {
    selectBackendModeMock.mockReturnValue("app-server");
    isWorkerSupervisorReadyMock.mockReturnValue(true);
    const req = {};
    const res = createRes();
    const next = vi.fn();

    requireWorkerReady(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test("returns 503 when supervisor is not ready", () => {
    selectBackendModeMock.mockReturnValue("app-server");
    isWorkerSupervisorReadyMock.mockReturnValue(false);
    const statusPayload = { ready: false };
    getWorkerStatusMock.mockReturnValue(statusPayload);
    const req = {};
    const res = createRes();
    const next = vi.fn();

    requireWorkerReady(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(applyCorsMock).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          type: "backend_unavailable",
          code: "worker_not_ready",
        }),
        worker_status: statusPayload,
      })
    );
  });
});
