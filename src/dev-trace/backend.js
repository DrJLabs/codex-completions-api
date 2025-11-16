import { appendProtoEvent } from "../dev-logging.js";
import { sanitizeRpcPayload } from "./sanitize.js";
import { ensureReqId } from "../lib/request-context.js";

const base = (trace = {}) => ({
  req_id: trace.reqId || trace.req_id || null,
  route: trace.route || null,
  mode: trace.mode || null,
});

const hasTrace = (trace) =>
  Boolean(trace && (trace.reqId || trace.req_id || trace.route || trace.mode));

export function logBackendSubmission(trace, { rpcId, method, params }) {
  if (!hasTrace(trace)) return;
  appendProtoEvent({
    ts: Date.now(),
    phase: "backend_submission",
    direction: "outbound",
    kind: "rpc_request",
    rpc_id: rpcId,
    method,
    payload: sanitizeRpcPayload(params),
    ...base(trace),
  });
}

export function logBackendResponse(trace, { rpcId, method, result, error }) {
  if (!hasTrace(trace)) return;
  appendProtoEvent({
    ts: Date.now(),
    phase: "backend_io",
    direction: "inbound",
    kind: error ? "rpc_error" : "rpc_response",
    rpc_id: rpcId,
    method,
    payload: sanitizeRpcPayload(error || result),
    ...base(trace),
  });
}

export function logBackendNotification(trace, { method, params }) {
  if (!hasTrace(trace)) return;
  const payload = sanitizeRpcPayload(params);
  appendProtoEvent({
    ts: Date.now(),
    phase: "backend_io",
    direction: "inbound",
    kind: "rpc_notification",
    notification_method: method,
    payload,
    ...base(trace),
  });
  if (params && (params.tool_calls || params.tool_call || params.kind === "tool_call")) {
    appendProtoEvent({
      ts: Date.now(),
      phase: "backend_io",
      direction: "inbound",
      kind: "tool_block",
      notification_method: method,
      payload: sanitizeRpcPayload(params.tool_calls || params.tool_call || params),
      ...base(trace),
    });
  }
}

export function logBackendLifecycle(event, detail = {}) {
  appendProtoEvent({
    ts: Date.now(),
    phase: "backend_lifecycle",
    direction: "none",
    kind: event,
    payload: detail,
    req_id: null,
    route: null,
    mode: null,
  });
}

export function traceFromResponse(res) {
  if (!res) return {};
  const reqId = ensureReqId(res);
  return {
    reqId,
    route: res.locals?.httpRoute || null,
    mode: res.locals?.mode || null,
  };
}
