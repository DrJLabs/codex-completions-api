import { config as CFG } from "../config/index.js";
import { appendProtoEvent } from "../dev-logging.js";
import { sanitizeBody } from "../dev-trace/sanitize.js";
import { ensureReqId, getHttpContext } from "../lib/request-context.js";

const SSE_KEEPALIVE_MS = CFG.PROXY_SSE_KEEPALIVE_MS;
const JSON_LOGGER_KEY = Symbol.for("codex.proxy.jsonLogger");
const SSE_DONE_FLAG = Symbol.for("codex.proxy.sseDoneLogged");

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
  logClientSse(res, payload);
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
  logClientSseDone(res);
  try {
    res.write("data: [DONE]\n\n");
    res.end();
  } catch {}
}

function emitClientEgress(res, event) {
  const { route, mode } = getHttpContext(res);
  const reqId = ensureReqId(res);
  appendProtoEvent({
    ts: Date.now(),
    route,
    mode,
    req_id: reqId,
    phase: "client_egress",
    direction: "outbound",
    status_code: res.statusCode || 200,
    ...event,
  });
}

function logClientSse(res, payload) {
  emitClientEgress(res, {
    kind: "client_sse",
    payload: sanitizeBody(payload),
  });
}

function logClientSseDone(res) {
  if (!res.locals) res.locals = {};
  // eslint-disable-next-line security/detect-object-injection -- symbol-based cache marker
  if (res.locals[SSE_DONE_FLAG]) return;
  // eslint-disable-next-line security/detect-object-injection -- symbol-based cache marker
  res.locals[SSE_DONE_FLAG] = true;
  emitClientEgress(res, {
    kind: "client_sse_done",
    payload: "[DONE]",
  });
}

export function logJsonResponse(res, body, { statusCode } = {}) {
  emitClientEgress(res, {
    kind: "client_json",
    status_code: statusCode ?? res.statusCode ?? 200,
    payload: sanitizeBody(body),
  });
}

export function installJsonLogger(res) {
  // eslint-disable-next-line security/detect-object-injection -- internal flag in response object
  if (!res || res[JSON_LOGGER_KEY]) return;
  const originalJson = res.json.bind(res);
  // eslint-disable-next-line security/detect-object-injection -- internal flag in response object
  res[JSON_LOGGER_KEY] = originalJson;
  res.json = (body, ...args) => {
    try {
      logJsonResponse(res, body);
    } catch {}
    return originalJson(body, ...args);
  };
}
