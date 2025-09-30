import express from "express";
import fs from "node:fs/promises";
import accessLog from "./middleware/access-log.js";
import { applyCors as applyCorsUtil } from "./utils.js";
import { config as CFG } from "./config/index.js";
import healthRouter from "./routes/health.js";
import modelsRouter from "./routes/models.js";
import chatRouter from "./routes/chat.js";
import usageRouter from "./routes/usage.js";
import rateLimit from "./middleware/rate-limit.js";
import { guardSnapshot } from "./services/concurrency-guard.js";

export default function createApp() {
  const app = express();
  app.use(express.json({ limit: "16mb" }));

  // Global CORS
  const CORS_ENABLED = CFG.PROXY_ENABLE_CORS.toLowerCase() !== "false";
  const CORS_ALLOWED = CFG.PROXY_CORS_ALLOWED_ORIGINS;
  const applyCors = (req, res) => applyCorsUtil(req, res, CORS_ENABLED, CORS_ALLOWED);
  app.use((req, res, next) => {
    applyCors(req, res);
    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }
    next();
  });

  // Minimal HTTP access logging (text line) to preserve current behavior
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      try {
        const ua = req.headers["user-agent"] || "";
        const auth = req.headers.authorization ? "present" : "none";
        const dur = Date.now() - start;
        console.log(
          `[http] ${req.method} ${req.originalUrl} -> ${res.statusCode} auth=${auth} ua="${ua}" dur_ms=${dur}`
        );
      } catch {}
    });
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
    // NOTE: Test-only endpoint to expose current SSE concurrency count.
    // Uses globalThis to avoid plumbing state; safe because PROXY_TEST_ENDPOINTS
    // is disabled in production by default and only enabled for CI debugging.
    app.get("/__test/conc", (_req, res) => {
      res.json({ conc: guardSnapshot() });
    });
    app.post("/__test/conc/release", async (_req, res) => {
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
  }
  app.use(healthRouter());
  app.use(modelsRouter());
  app.use(chatRouter());
  app.use(usageRouter());

  return app;
}
