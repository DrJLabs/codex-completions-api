import { Router } from "express";
import { postResponsesStream } from "../handlers/responses/stream.js";
import { postResponsesNonStream } from "../handlers/responses/nonstream.js";
import { config as CFG } from "../config/index.js";
import { requireStrictAuth } from "../middleware/auth.js";
import { requireWorkerReady } from "../middleware/worker-ready.js";

export default function responsesRouter() {
  const r = Router();
  const defaultStream = CFG.PROXY_DEFAULT_STREAM;

  r.head("/v1/responses", requireStrictAuth, requireWorkerReady, (_req, res) => {
    res.set("Content-Type", "application/json; charset=utf-8");
    res.status(200).end();
  });

  r.post("/v1/responses", requireStrictAuth, requireWorkerReady, (req, res) => {
    const body = req?.body || {};
    const stream = Object.prototype.hasOwnProperty.call(body, "stream")
      ? !!body.stream
      : defaultStream;
    if (stream) return postResponsesStream(req, res);
    return postResponsesNonStream(req, res);
  });

  return r;
}
