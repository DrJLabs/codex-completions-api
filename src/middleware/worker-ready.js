import { selectBackendMode, BACKEND_APP_SERVER } from "../services/backend-mode.js";
import { isWorkerSupervisorReady, getWorkerStatus } from "../services/worker/supervisor.js";
import { applyCors as applyCorsUtil } from "../utils.js";
import { config as CFG } from "../config/index.js";

const CORS_ENABLED = CFG.PROXY_ENABLE_CORS.toLowerCase() !== "false";
const CORS_ALLOWED = CFG.PROXY_CORS_ALLOWED_ORIGINS;

export function requireWorkerReady(req, res, next) {
  const backendMode = selectBackendMode();
  if (backendMode !== BACKEND_APP_SERVER) {
    return next();
  }

  if (isWorkerSupervisorReady()) {
    return next();
  }

  console.warn("[proxy][worker-supervisor] worker not ready; returning 503 backend_unavailable");
  applyCorsUtil(req, res, CORS_ENABLED, CORS_ALLOWED);
  return res.status(503).json({
    error: {
      message: "app-server worker is not ready",
      type: "backend_unavailable",
      code: "worker_not_ready",
      retryable: true,
    },
    worker_status: getWorkerStatus(),
  });
}
