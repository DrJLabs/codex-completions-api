import { Router } from "express";
import { guardSnapshot } from "../services/concurrency-guard.js";
import { getWorkerStatus } from "../services/worker/supervisor.js";
import {
  renderMetrics,
  setActiveStreams,
  setMaintenanceState,
  setWorkerMetrics,
  observeWorkerRestartDelta,
} from "../services/metrics/index.js";
import { config as CFG } from "../config/index.js";

const isLoopback = (ip = "") => {
  if (!ip) return false;
  const normalized = ip.replace("::ffff:", "");
  return normalized === "127.0.0.1" || normalized === "::1";
};

const hasMetricsBearer = (req) => {
  const token = (CFG.PROXY_METRICS_TOKEN || "").trim();
  if (!token) return false;
  const value = String(req.headers?.authorization ?? "");
  if (!value.toLowerCase().startsWith("bearer ")) return false;
  return value.slice(7).trim() === token;
};

const isMetricsAuthorized = (req) => {
  if (CFG.PROXY_METRICS_ALLOW_UNAUTH) return true;
  if (hasMetricsBearer(req)) return true;
  if (CFG.PROXY_METRICS_ALLOW_LOOPBACK && isLoopback(req.ip || req.connection?.remoteAddress)) {
    return true;
  }
  return false;
};

export default function metricsRouter() {
  const r = Router();

  r.get("/metrics", async (_req, res) => {
    if (!isMetricsAuthorized(_req)) {
      return res.status(403).json({ ok: false, reason: "metrics access denied" });
    }
    setActiveStreams(guardSnapshot());
    const workerStatus = getWorkerStatus();
    observeWorkerRestartDelta(workerStatus);
    setWorkerMetrics(workerStatus);
    setMaintenanceState(Boolean(CFG.PROXY_MAINTENANCE_MODE));
    const payload = await renderMetrics();
    res.set("Content-Type", "text/plain; charset=utf-8");
    res.end(payload);
  });

  return r;
}
