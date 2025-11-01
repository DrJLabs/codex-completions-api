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
    const supervisorHealth = supervisorStatus.health || {};
    const readiness = appServerEnabled
      ? {
          ...(supervisorHealth.readiness ?? {
            ready: false,
            reason: "worker_not_started",
          }),
        }
      : {
          ready: true,
          reason: "app_server_disabled",
        };
    const liveness = appServerEnabled
      ? {
          ...(supervisorHealth.liveness ?? {
            live: false,
            reason: "worker_not_started",
          }),
        }
      : {
          live: true,
          reason: "app_server_disabled",
        };
    const health = { readiness, liveness };
    const workerSupervisor = appServerEnabled
      ? { ...supervisorStatus, health }
      : {
          ...supervisorStatus,
          enabled: false,
          ready: true,
          health,
        };
    return {
      backendMode,
      appServerEnabled,
      health,
      workerSupervisor,
    };
  }

  router.get("/healthz", (_req, res) => {
    const snapshot = buildWorkerSnapshots();
    const healthy =
      snapshot.health.liveness.live &&
      (!snapshot.appServerEnabled || snapshot.health.readiness.ready);
    res.json({
      ok: healthy,
      sandbox_mode: CFG.PROXY_SANDBOX_MODE,
      backend_mode: snapshot.backendMode,
      app_server_enabled: snapshot.appServerEnabled,
      health: snapshot.health,
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
        health: { readiness: snapshot.health.readiness },
      });
    }
    const statusCode = snapshot.health.readiness.ready ? 200 : 503;
    return res.status(statusCode).json({
      ok: snapshot.health.readiness.ready,
      backend_mode: snapshot.backendMode,
      app_server_enabled: true,
      health: { readiness: snapshot.health.readiness },
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
        health: { liveness: snapshot.health.liveness },
      });
    }
    const statusCode = snapshot.health.liveness.live ? 200 : 503;
    return res.status(statusCode).json({
      ok: snapshot.health.liveness.live,
      backend_mode: snapshot.backendMode,
      app_server_enabled: true,
      health: { liveness: snapshot.health.liveness },
      worker_supervisor: snapshot.workerSupervisor,
    });
  });
  return router;
}
