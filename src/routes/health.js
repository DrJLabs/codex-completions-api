import express from "express";
import { config as CFG } from "../config/index.js";
import { selectBackendMode, BACKEND_APP_SERVER } from "../services/backend-mode.js";
import { getWorkerStatus } from "../services/worker/supervisor.js";

export default function healthRouter() {
  const router = express.Router();

  function buildWorkerSnapshots() {
    const backendMode = selectBackendMode();
    const supervisorStatus = getWorkerStatus();
    const appServerEnabled = backendMode === BACKEND_APP_SERVER;
    const readiness = appServerEnabled
      ? (supervisorStatus.readiness ?? {
          ready: false,
          reason: "worker_not_started",
        })
      : {
          ready: true,
          reason: "app_server_disabled",
        };
    const liveness = appServerEnabled
      ? (supervisorStatus.liveness ?? {
          live: false,
          reason: "worker_not_started",
        })
      : {
          live: true,
          reason: "app_server_disabled",
        };
    const workerSupervisor = appServerEnabled
      ? supervisorStatus
      : {
          ...supervisorStatus,
          enabled: false,
          ready: true,
          readiness,
          liveness,
          health: {
            readiness,
            liveness,
          },
        };
    return {
      backendMode,
      appServerEnabled,
      readiness,
      liveness,
      workerSupervisor,
    };
  }

  router.get("/healthz", (_req, res) => {
    const snapshot = buildWorkerSnapshots();
    const healthy =
      snapshot.liveness.live && (!snapshot.appServerEnabled || snapshot.readiness.ready);
    res.json({
      ok: healthy,
      sandbox_mode: CFG.PROXY_SANDBOX_MODE,
      backend_mode: snapshot.backendMode,
      app_server_enabled: snapshot.appServerEnabled,
      readiness: snapshot.readiness,
      liveness: snapshot.liveness,
      worker_supervisor: snapshot.workerSupervisor,
    });
  });

  router.get("/readyz", (_req, res) => {
    const snapshot = buildWorkerSnapshots();
    if (!snapshot.appServerEnabled) {
      return res.json({
        ok: true,
        backend_mode: snapshot.backendMode,
        app_server_enabled: false,
        readiness: snapshot.readiness,
      });
    }
    const statusCode = snapshot.readiness.ready ? 200 : 503;
    return res.status(statusCode).json({
      ok: snapshot.readiness.ready,
      backend_mode: snapshot.backendMode,
      app_server_enabled: true,
      readiness: snapshot.readiness,
      worker_supervisor: snapshot.workerSupervisor,
    });
  });

  router.get("/livez", (_req, res) => {
    const snapshot = buildWorkerSnapshots();
    if (!snapshot.appServerEnabled) {
      return res.json({
        ok: true,
        backend_mode: snapshot.backendMode,
        app_server_enabled: false,
        liveness: snapshot.liveness,
      });
    }
    const statusCode = snapshot.liveness.live ? 200 : 503;
    return res.status(statusCode).json({
      ok: snapshot.liveness.live,
      backend_mode: snapshot.backendMode,
      app_server_enabled: true,
      liveness: snapshot.liveness,
      worker_supervisor: snapshot.workerSupervisor,
    });
  });
  return router;
}
