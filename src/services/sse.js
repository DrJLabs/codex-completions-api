import { config as CFG } from "../config/index.js";
import { appendProtoEvent } from "../dev-logging.js";
import { sanitizeBody } from "../dev-trace/sanitize.js";
import { ensureReqId, getHttpContext } from "../lib/request-context.js";

const SSE_KEEPALIVE_MS = CFG.PROXY_SSE_KEEPALIVE_MS;
const JSON_LOGGER_KEY = Symbol.for("codex.proxy.jsonLogger");
const SSE_DONE_FLAG = Symbol.for("codex.proxy.sseDoneLogged");
const SSE_QUEUE_KEY = Symbol.for("codex.proxy.sseQueue");
const SSE_FLUSHING_KEY = Symbol.for("codex.proxy.sseQueueFlushing");

const ensureSseQueue = (res) => {
  if (!res.locals) res.locals = {};
  // eslint-disable-next-line security/detect-object-injection -- symbol-based queue cache
  let queue = res.locals[SSE_QUEUE_KEY];
  if (!queue) {
    queue = [];
    // eslint-disable-next-line security/detect-object-injection -- symbol-based queue cache
    res.locals[SSE_QUEUE_KEY] = queue;
  }
  return queue;
};

const flushSseQueue = (res) => {
  if (!res || res.writableEnded) return;
  if (!res.locals) res.locals = {};
  // eslint-disable-next-line security/detect-object-injection -- symbol-based queue cache
  if (res.locals[SSE_FLUSHING_KEY]) return;
  // eslint-disable-next-line security/detect-object-injection -- symbol-based queue cache
  res.locals[SSE_FLUSHING_KEY] = true;
  const queue = ensureSseQueue(res);
  const run = async () => {
    while (queue.length) {
      const { chunk, resolve } = queue.shift();
      let ok = true;
      try {
        ok = res.write(chunk);
        res.flush?.();
      } catch {}
      if (!ok) {
        await new Promise((_resolve) => res.once("drain", _resolve));
      }
      if (typeof resolve === "function") resolve(ok);
    }
    // eslint-disable-next-line security/detect-object-injection -- symbol-based queue cache
    res.locals[SSE_FLUSHING_KEY] = false;
  };
  void run();
};

export function writeSseChunk(res, chunk) {
  if (!res || res.writableEnded) return Promise.resolve(false);
  const queue = ensureSseQueue(res);
  return new Promise((resolve) => {
    queue.push({ chunk, resolve });
    flushSseQueue(res);
  });
}

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
        else writeSseChunk(res, `: keepalive ${Date.now()}\n\n`);
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
    return writeSseChunk(res, `data: ${JSON.stringify(payload)}\n\n`);
  } catch {}
  return null;
}

export function sendComment(res, text) {
  try {
    return writeSseChunk(res, `: ${String(text)}\n\n`);
  } catch {}
  return null;
}

export function finishSSE(res) {
  logClientSseDone(res);
  try {
    const done = writeSseChunk(res, "data: [DONE]\n\n");
    if (done && typeof done.then === "function") {
      done.then(() => res.end()).catch(() => res.end());
      return;
    }
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
