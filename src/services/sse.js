import { config as CFG } from "../config/index.js";

const SSE_KEEPALIVE_MS = CFG.PROXY_SSE_KEEPALIVE_MS;

export function setSSEHeaders(res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
}

export function computeKeepaliveMs(req) {
  const ua = String(req.headers["user-agent"] || "");
  const disableUA = /Obsidian|Electron/i.test(ua);
  const disableHeader = String(req.headers["x-no-keepalive"] || "").trim() === "1";
  const disableQuery = String(req.query?.no_keepalive || "").trim() === "1";
  return disableUA || disableHeader || disableQuery ? 0 : SSE_KEEPALIVE_MS;
}

export function startKeepalives(res, intervalMs, writer) {
  let timer = null;
  if (intervalMs > 0) {
    timer = setInterval(() => {
      try {
        if (typeof writer === "function") writer();
        else res.write(`: keepalive ${Date.now()}\n\n`);
      } catch {}
    }, intervalMs);
  }
  return {
    stop() {
      if (!timer) return;
      try {
        clearInterval(timer);
      } catch {}
      timer = null;
    },
  };
}

export function sendSSE(res, payload) {
  try {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    res.flush?.();
  } catch {}
}

export function sendComment(res, text) {
  try {
    res.write(`: ${String(text)}\n\n`);
    res.flush?.();
  } catch {}
}

export function finishSSE(res) {
  try {
    res.write("data: [DONE]\n\n");
    res.end();
  } catch {}
}
