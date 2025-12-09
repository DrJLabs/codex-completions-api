import express from "express";
import fs from "node:fs/promises";
import accessLog from "./middleware/access-log.js";
import { applyCors as applyCorsUtil } from "./utils.js";
import { config as CFG } from "./config/index.js";
import healthRouter from "./routes/health.js";
import modelsRouter from "./routes/models.js";
import chatRouter from "./routes/chat.js";
import responsesRouter from "./routes/responses.js";
import usageRouter from "./routes/usage.js";
import metricsRouter from "./routes/metrics.js";
import rateLimit from "./middleware/rate-limit.js";
import { guardSnapshot } from "./services/concurrency-guard.js";
import { toolBufferMetrics } from "./services/metrics/chat.js";
import { logStructured } from "./services/logging/schema.js";
import metricsMiddleware from "./middleware/metrics.js";
import { requireTestAuth } from "./middleware/auth.js";

export default function createApp() {
  const app = express();
  app.use(express.json({ limit: "16mb" }));
  app.use(metricsMiddleware());

  // Global CORS
  const CORS_ENABLED = CFG.PROXY_ENABLE_CORS.toLowerCase() !== "false";
  const CORS_ALLOWED = CFG.PROXY_CORS_ALLOWED_ORIGINS;
  const applyCors = (req, res) => applyCorsUtil(req, res, CORS_ENABLED, CORS_ALLOWED);
  app.use((req, res, next) => {
    applyCors(req, res);
    if (CFG.PROXY_LOG_CORS_ORIGIN) {
      const origin = req.headers?.origin ?? "";
      const acrMethod = req.headers?.["access-control-request-method"] ?? "";
      const acrHeaders = req.headers?.["access-control-request-headers"] ?? "";
      const ua = req.headers?.["user-agent"] ?? "";
      logStructured(
        {
          component: "http",
          event: "cors_preflight",
          level: "info",
          route: req.originalUrl,
        },
        {
          method: req.method,
          origin,
          acr_method: acrMethod,
          acr_headers: acrHeaders,
          ua,
        }
      );
    }
    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }
    next();
  });

  // Structured JSON access log
  app.use(accessLog());

  // Mount routers
  app.use(
    rateLimit({
      enabled: CFG.PROXY_RATE_LIMIT_ENABLED,
      windowMs: CFG.PROXY_RATE_LIMIT_WINDOW_MS,
      max: CFG.PROXY_RATE_LIMIT_MAX,
    })
  );
  // Test-only endpoints (disabled by default)
  if (CFG.PROXY_TEST_ENDPOINTS) {
    const testRouter = express.Router();
    testRouter.use(requireTestAuth);
    // NOTE: Test-only endpoint to expose current SSE concurrency count.
    // Uses globalThis to avoid plumbing state; safe because PROXY_TEST_ENDPOINTS
    // is disabled in production by default and only enabled for CI debugging.
    testRouter.get("/conc", (_req, res) => {
      res.json({ conc: guardSnapshot() });
    });
    testRouter.post("/conc/release", async (_req, res) => {
      const releasePath = process.env.STREAM_RELEASE_FILE;
      if (!releasePath) {
        return res.status(400).json({ ok: false, reason: "STREAM_RELEASE_FILE not set" });
      }
      try {
        // STREAM_RELEASE_FILE is only used in test harnesses; guard is sufficient here.
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        await fs.writeFile(releasePath, String(Date.now()), "utf8");
        return res.json({ ok: true });
      } catch (error) {
        return res.status(500).json({ ok: false, error: error?.message || String(error) });
      }
    });
    testRouter.get("/tool-buffer-metrics", (_req, res) => {
      res.json({ ok: true, summary: toolBufferMetrics.summary() });
    });
    testRouter.post("/tool-buffer-metrics/reset", (_req, res) => {
      toolBufferMetrics.reset();
      res.json({ ok: true });
    });
    app.use("/__test", testRouter);
  }
  if (CFG.PROXY_ENABLE_METRICS) {
    app.use(metricsRouter());
  }
  app.use(healthRouter());
  app.use(modelsRouter());
  app.use(chatRouter());
  app.use(responsesRouter());
  app.use(usageRouter());

  return app;
}
