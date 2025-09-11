import express from "express";
import { config as CFG } from "../config/index.js";
import { publicModelIds } from "../config/models.js";
import { authErrorBody } from "../lib/errors.js";
import { applyCors as applyCorsUtil } from "../utils.js";

export default function modelsRouter() {
  const router = express.Router();
  const CORS_ENABLED = CFG.PROXY_ENABLE_CORS.toLowerCase() !== "false";
  const applyCors = (_req, res) => applyCorsUtil(_req, res, CORS_ENABLED);

  const isDev = (CFG.PROXY_ENV || "").toLowerCase() === "dev";
  const PUBLIC_MODEL_IDS = publicModelIds(isDev);
  const modelsPayload = {
    object: "list",
    data: PUBLIC_MODEL_IDS.map((id) => ({ id, object: "model", owned_by: "codex", created: 0 })),
  };

  const sendModels = (res) => {
    applyCors(null, res);
    res.set("Content-Type", "application/json; charset=utf-8");
    res.set("Cache-Control", "public, max-age=60");
    res.status(200).send(JSON.stringify(modelsPayload));
  };

  function gated(req, res) {
    if (!CFG.PROTECT_MODELS) return true;
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token || token !== CFG.API_KEY) {
      applyCors(null, res);
      res.status(401).set("WWW-Authenticate", "Bearer realm=api").json(authErrorBody());
      return false;
    }
    return true;
  }

  // GET
  router.get(["/v1/models", "/v1/models/"], (req, res) => {
    if (!gated(req, res)) return;
    sendModels(res);
  });

  // HEAD
  router.head("/v1/models", (req, res) => {
    if (!gated(req, res)) return;
    applyCors(null, res);
    res.set("Content-Type", "application/json; charset=utf-8");
    res.status(200).end();
  });
  router.head("/v1/models/", (req, res) => {
    if (!gated(req, res)) return;
    applyCors(null, res);
    res.set("Content-Type", "application/json; charset=utf-8");
    res.status(200).end();
  });

  return router;
}
