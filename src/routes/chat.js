import { Router } from "express";
import { postChatStream, postCompletionsStream } from "../handlers/chat/stream.js";
import { postChatNonStream, postCompletionsNonStream } from "../handlers/chat/nonstream.js";

export default function chatRouter() {
  const r = Router();

  // HEAD for chat and legacy shim (OPTIONS handled globally with 204 preflight)
  const completionPaths = ["/v1/chat/completions", "/v1/completions"];
  r.head(completionPaths, (_req, res) => {
    res.set("Content-Type", "application/json; charset=utf-8");
    res.status(200).end();
  });

  // POST routes for chat and legacy completions
  r.post("/v1/chat/completions", (req, res) => {
    const stream = !!(req?.body && req.body.stream);
    if (stream) return postChatStream(req, res);
    return postChatNonStream(req, res);
  });

  r.post("/v1/completions", (req, res) => {
    const stream = !!(req?.body && req.body.stream);
    if (stream) return postCompletionsStream(req, res);
    return postCompletionsNonStream(req, res);
  });

  return r;
}
