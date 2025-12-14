import { Router } from "express";
import { postChatStream, postCompletionsStream } from "../handlers/chat/stream.js";
import { postChatNonStream, postCompletionsNonStream } from "../handlers/chat/nonstream.js";
import { config as CFG } from "../config/index.js";
import { requireStrictAuth } from "../middleware/auth.js";
import { requireWorkerReady } from "../middleware/worker-ready.js";

export default function chatRouter() {
  const r = Router();
  const defaultStream = CFG.PROXY_DEFAULT_STREAM;

  // HEAD for chat and legacy shim (OPTIONS handled globally with 204 preflight)
  const completionPaths = ["/v1/chat/completions", "/v1/completions"];
  r.head(completionPaths, requireStrictAuth, (_req, res) => {
    res.set("Content-Type", "application/json; charset=utf-8");
    res.status(200).end();
  });

  // POST routes for chat and legacy completions
  r.post("/v1/chat/completions", requireStrictAuth, requireWorkerReady, (req, res) => {
    const body = req?.body || {};
    const stream = Object.prototype.hasOwnProperty.call(body, "stream")
      ? !!body.stream
      : defaultStream;
    if (stream) return postChatStream(req, res);
    return postChatNonStream(req, res);
  });

  r.post("/v1/completions", requireStrictAuth, requireWorkerReady, (req, res) => {
    const body = req?.body || {};
    const stream = Object.prototype.hasOwnProperty.call(body, "stream")
      ? !!body.stream
      : defaultStream;
    if (stream) return postCompletionsStream(req, res);
    return postCompletionsNonStream(req, res);
  });

  return r;
}
