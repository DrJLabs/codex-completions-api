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
import tracingMiddleware from "./middleware/tracing.js";
import { invalidRequestBody, serverErrorBody } from "./lib/errors.js";

export default function createApp() {
  const app = express();
  const trustProxyValue = (() => {
    const raw = CFG.PROXY_TRUST_PROXY;
    const trimmed = raw === undefined || raw === null ? "" : String(raw).trim();
    if (!trimmed) return false;
    const normalized = trimmed.toLowerCase();
    if (["false", "0", "off", "no"].includes(normalized)) return false;
    if (["true", "1", "on", "yes"].includes(normalized)) return true;
    return trimmed;
  })();
  app.set("trust proxy", trustProxyValue);
  app.use(metricsMiddleware());
  app.use(tracingMiddleware());

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

  // JSON body parsing (after tracing/metrics/CORS/access logging so parse errors still get those headers)
  app.use(express.json({ limit: "16mb" }));

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
  if (CFG.PROXY_ENABLE_RESPONSES) {
    app.use(responsesRouter());
  }
  app.use(usageRouter());

  // Error handler: ensure body-parser errors return OpenAI-style JSON instead of HTML.
  // Must be registered after express.json().
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    applyCors(req, res);
    const status = Number.isInteger(err?.status)
      ? err.status
      : Number.isInteger(err?.statusCode)
        ? err.statusCode
        : 0;
    const type = typeof err?.type === "string" ? err.type : "";
    const isBodyParserError =
      status >= 400 &&
      status < 500 &&
      (type.startsWith("entity.") ||
        type.startsWith("request.") ||
        type.startsWith("charset.") ||
        type.startsWith("encoding."));
    if (!isBodyParserError) return next(err);

    let message = "Invalid request body";
    let code = "invalid_request_error";
    if (type === "entity.parse.failed") {
      message = "Invalid JSON";
      code = "invalid_json";
    } else if (type === "entity.too.large" || status === 413) {
      message = "Request body too large";
      code = "request_entity_too_large";
    } else if (
      type === "encoding.unsupported" ||
      type === "charset.unsupported" ||
      status === 415
    ) {
      message = "Unsupported encoding";
      code = "unsupported_encoding";
    } else if (type === "request.aborted") {
      message = "Request aborted";
      code = "request_aborted";
    }

    return res.status(status || 400).json(invalidRequestBody(null, message, code));
  });

  // Final error handler: ensure unexpected errors remain JSON (not Express HTML).
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    applyCors(req, res);
    const status = Number.isInteger(err?.status)
      ? err.status
      : Number.isInteger(err?.statusCode)
        ? err.statusCode
        : 500;
    const statusCode = status >= 400 && status < 600 ? status : 500;
    const payload =
      statusCode >= 500
        ? serverErrorBody()
        : invalidRequestBody(null, err?.message || "invalid request");
    return res.status(statusCode).json(payload);
  });

  return app;
}
