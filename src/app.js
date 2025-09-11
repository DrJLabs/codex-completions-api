import express from "express";
import accessLog from "./middleware/access-log.js";
import { applyCors as applyCorsUtil } from "./utils.js";
import { config as CFG } from "./config/index.js";
import healthRouter from "./routes/health.js";
import modelsRouter from "./routes/models.js";
import chatRouter from "./routes/chat.js";

export default function createApp() {
  const app = express();
  app.use(express.json({ limit: "16mb" }));

  // Global CORS
  const CORS_ENABLED = CFG.PROXY_ENABLE_CORS.toLowerCase() !== "false";
  const applyCors = (req, res) => applyCorsUtil(req, res, CORS_ENABLED);
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
  app.use(healthRouter());
  app.use(modelsRouter());
  app.use(chatRouter());

  return app;
}
