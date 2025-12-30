import { Router } from "express";
import { postResponsesStream } from "../handlers/responses/stream.js";
import { postResponsesNonStream } from "../handlers/responses/nonstream.js";
import { requireWorkerReady } from "../middleware/worker-ready.js";
import { requireStrictAuth } from "../middleware/auth.js";
import { maybeHandleTitleSummaryIntercept } from "../handlers/responses/title-summary-intercept.js";

export default function responsesRouter() {
  const r = Router();

  r.head("/v1/responses", requireStrictAuth, requireWorkerReady, (_req, res) => {
    res.set("Content-Type", "application/json; charset=utf-8");
    res.status(200).end();
  });

  r.post("/v1/responses", requireStrictAuth, async (req, res) => {
    const stream = !!(req?.body && req.body.stream);

    if (
      await maybeHandleTitleSummaryIntercept({
        req,
        res,
        body: req?.body || {},
        stream,
      })
    ) {
      return;
    }

    return requireWorkerReady(req, res, () => {
      if (stream) return postResponsesStream(req, res);
      return postResponsesNonStream(req, res);
    });
  });

  return r;
}
