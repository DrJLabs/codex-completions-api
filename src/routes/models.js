import express from "express";
import { config as CFG } from "../config/index.js";
import { publicModelIds } from "../config/models.js";
import { applyCors as applyCorsUtil } from "../utils.js";
import { requireStrictAuth } from "../middleware/auth.js";

export default function modelsRouter() {
  const router = express.Router();
  const CORS_ENABLED = CFG.PROXY_ENABLE_CORS.toLowerCase() !== "false";
  const CORS_ALLOWED = CFG.PROXY_CORS_ALLOWED_ORIGINS;
  const applyCors = (req, res) => applyCorsUtil(req, res, CORS_ENABLED, CORS_ALLOWED);

  const isDev = (CFG.PROXY_ENV || "").toLowerCase() === "dev";
  const PUBLIC_MODEL_IDS = publicModelIds(isDev);
  const modelsPayload = {
    object: "list",
    data: PUBLIC_MODEL_IDS.map((id) => ({ id, object: "model", owned_by: "codex", created: 0 })),
  };

  const sendModels = (req, res) => {
    applyCors(req, res);
    res.set("Content-Type", "application/json; charset=utf-8");
    res.set("Cache-Control", "public, max-age=60");
    res.status(200).send(JSON.stringify(modelsPayload));
  };

  if (CFG.PROTECT_MODELS) {
    router.use(requireStrictAuth);
  }

  // GET
  router.get(["/v1/models", "/v1/models/"], (req, res) => {
    sendModels(req, res);
  });

  // HEAD
  router.head(["/v1/models", "/v1/models/"], (req, res) => {
    applyCors(req, res);
    res.set("Content-Type", "application/json; charset=utf-8");
    res.status(200).end();
  });

  return router;
}
