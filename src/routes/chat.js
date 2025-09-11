import { Router } from "express";

export default function chatRouter() {
  const r = Router();

  // HEAD for chat and legacy shim (OPTIONS handled globally with 204 preflight)
  const completionPaths = ["/v1/chat/completions", "/v1/completions"];
  r.head(completionPaths, (_req, res) => {
    res.set("Content-Type", "application/json; charset=utf-8");
    res.status(200).end();
  });

  return r;
}
