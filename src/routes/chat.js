import { Router } from "express";
import { postChatStream } from "../handlers/chat/stream.js";
import { postChatNonStream } from "../handlers/chat/nonstream.js";
import { config as CFG } from "../config/index.js";
import { requireStrictAuth } from "../middleware/auth.js";
import { requireWorkerReady } from "../middleware/worker-ready.js";
import { maybeHandleTitleIntercept } from "../lib/title-intercept.js";

export default function chatRouter() {
  const r = Router();
  const defaultStream = CFG.PROXY_DEFAULT_STREAM;

  // HEAD for chat (OPTIONS handled globally with 204 preflight)
  r.head("/v1/chat/completions", requireStrictAuth, (_req, res) => {
    res.set("Content-Type", "application/json; charset=utf-8");
    res.status(200).end();
  });

  // POST routes for chat
  r.post("/v1/chat/completions", requireStrictAuth, async (req, res, next) => {
    try {
      const body = req?.body || {};
      const stream = Object.prototype.hasOwnProperty.call(body, "stream")
        ? !!body.stream
        : defaultStream;

      if (
        await maybeHandleTitleIntercept({
          req,
          res,
          body,
          stream,
        })
      ) {
        return;
      }

      return requireWorkerReady(req, res, () => {
        if (stream) return postChatStream(req, res);
        return postChatNonStream(req, res);
      });
    } catch (err) {
      next(err);
    }
  });

  return r;
}
