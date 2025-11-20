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
    const restartMeta = appServerEnabled
      ? {
          restarts_total: supervisorStatus.restarts_total ?? 0,
          consecutive_failures: supervisorStatus.consecutive_failures ?? 0,
          next_restart_delay_ms: supervisorStatus.next_restart_delay_ms ?? 0,
          last_exit: supervisorStatus.last_exit ?? null,
          last_ready_at: supervisorStatus.last_ready_at ?? null,
          startup_latency_ms: supervisorStatus.startup_latency_ms ?? null,
          last_log_sample: supervisorStatus.last_log_sample ?? null,
        }
      : {
          restarts_total: 0,
          consecutive_failures: 0,
          next_restart_delay_ms: 0,
          last_exit: null,
          last_ready_at: null,
          startup_latency_ms: null,
          last_log_sample: null,
        };

    const readiness = appServerEnabled
      ? {
          ...(supervisorHealth.readiness ?? {
            ready: false,
            reason: "worker_not_started",
          }),
          details: {
            ...(supervisorHealth.readiness?.details ?? {}),
            ...restartMeta,
          },
        }
      : {
          ready: true,
          reason: "app_server_disabled",
          details: restartMeta,
        };
    const liveness = appServerEnabled
      ? {
          ...(supervisorHealth.liveness ?? {
            live: false,
            reason: "worker_not_started",
          }),
          details: {
            ...(supervisorHealth.liveness?.details ?? {}),
            ...restartMeta,
          },
        }
      : {
          live: true,
          reason: "app_server_disabled",
          details: restartMeta,
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
