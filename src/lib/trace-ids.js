import { nanoid } from "nanoid";

const COPILOT_TRACE_KEY = Symbol.for("codex.proxy.copilotTraceId");

const normalizeHeaderValue = (value) => {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== "string") return null;
  const trimmed = candidate.trim();
  if (!trimmed) return null;
  return trimmed.length > 256 ? trimmed.slice(0, 256) : trimmed;
};

export function ensureCopilotTraceId(req, res) {
  if (!res) return nanoid();
  res.locals = res.locals || {};
  const locals = res.locals;

  // eslint-disable-next-line security/detect-object-injection -- symbol-based local metadata
  const existing = locals.copilot_trace_id || locals[COPILOT_TRACE_KEY];
  if (existing) return existing;

  const inbound =
    normalizeHeaderValue(req?.headers?.["x-copilot-trace-id"]) ||
    normalizeHeaderValue(req?.headers?.["x-trace-id"]) ||
    normalizeHeaderValue(req?.headers?.["x-request-id"]);

  const value = inbound || nanoid();

  // eslint-disable-next-line security/detect-object-injection -- symbol-based local metadata
  locals[COPILOT_TRACE_KEY] = value;
  locals.copilot_trace_id = value;
  res.locals = locals;
  return value;
}
