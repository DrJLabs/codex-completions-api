import express from "express";
import { config as CFG } from "../config/index.js";
import { selectBackendMode, BACKEND_APP_SERVER } from "../services/backend-mode.js";

export default function healthRouter() {
  const router = express.Router();
  router.get("/healthz", (_req, res) => {
    const backendMode = selectBackendMode();
    res.json({
      ok: true,
      sandbox_mode: CFG.PROXY_SANDBOX_MODE,
      backend_mode: backendMode,
      app_server_enabled: backendMode === BACKEND_APP_SERVER,
    });
  });
  return router;
}
