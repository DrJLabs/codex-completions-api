import express from "express";
import { config as CFG } from "../config/index.js";

export default function healthRouter() {
  const router = express.Router();
  router.get("/healthz", (_req, res) => {
    res.json({ ok: true, sandbox_mode: CFG.PROXY_SANDBOX_MODE });
  });
  return router;
}
