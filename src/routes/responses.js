import { Router } from "express";
import { postResponsesStream } from "../handlers/responses/stream.js";
import { postResponsesNonStream } from "../handlers/responses/nonstream.js";
import { requireWorkerReady } from "../middleware/worker-ready.js";

export default function responsesRouter() {
  const r = Router();

  r.head("/v1/responses", requireWorkerReady, (_req, res) => {
    res.set("Content-Type", "application/json; charset=utf-8");
    res.status(200).end();
  });

  r.post("/v1/responses", requireWorkerReady, (req, res) => {
    const stream = !!(req?.body && req.body.stream);
    if (stream) return postResponsesStream(req, res);
    return postResponsesNonStream(req, res);
  });

  return r;
}
