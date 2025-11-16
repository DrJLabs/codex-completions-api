import { appendProtoEvent } from "../dev-logging.js";
import { sanitizeHeaders, sanitizeBody } from "./sanitize.js";
import { ensureReqId, getHttpContext } from "../lib/request-context.js";

const LOGGED_KEY = Symbol.for("codex.proxy.devTrace.loggedHttpIngress");

export function logHttpRequest({ req, res, route, mode, body }) {
  if (!req || !res) return;
  const locals = res.locals || {};
  // eslint-disable-next-line security/detect-object-injection -- symbol key cache
  if (locals[LOGGED_KEY]) return;

  const reqId = ensureReqId(res);
  const { route: ctxRoute, mode: ctxMode } = getHttpContext(res);

  const resolvedRoute = route || ctxRoute || req.originalUrl || req.url || "";
  const resolvedMode = mode || ctxMode;

  // eslint-disable-next-line security/detect-object-injection -- symbol key cache
  locals[LOGGED_KEY] = true;
  res.locals = locals;

  const sanitizedHeaders = sanitizeHeaders(req.headers || {});
  const payload = {
    ts: Date.now(),
    phase: "http_ingress",
    direction: "inbound",
    kind: "client_request",
    req_id: reqId,
    route: resolvedRoute,
    mode: resolvedMode,
    method: req.method,
    path: req.originalUrl || req.url || resolvedRoute,
    headers: sanitizedHeaders,
    body: sanitizeBody(body !== undefined ? body : req.body),
  };

  appendProtoEvent(payload);
}
