import { Router } from "express";

export default function chatRouter() {
  const r = Router();

  // HEAD/OPTIONS for /v1/chat/completions
  r.options("/v1/chat/completions", (_req, res) => {
    res.set("Allow", "POST,HEAD,OPTIONS");
    res.status(200).end();
  });
  r.head("/v1/chat/completions", (_req, res) => {
    res.set("Content-Type", "application/json; charset=utf-8");
    res.status(200).end();
  });

  // HEAD/OPTIONS for legacy /v1/completions shim
  r.options("/v1/completions", (_req, res) => {
    res.set("Allow", "POST,HEAD,OPTIONS");
    res.status(200).end();
  });
  r.head("/v1/completions", (_req, res) => {
    res.set("Content-Type", "application/json; charset=utf-8");
    res.status(200).end();
  });

  return r;
}
