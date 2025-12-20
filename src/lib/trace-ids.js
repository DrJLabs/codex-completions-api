import { nanoid } from "nanoid";

const COPILOT_TRACE_KEY = Symbol.for("codex.proxy.copilotTraceId");
const TRACE_HEADERS = ["x-copilot-trace-id", "x-trace-id", "x-request-id"];

const normalizeHeaderValue = (value) => {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== "string") return null;
  const trimmed = candidate.trim();
  if (!trimmed) return null;
  return trimmed.length > 256 ? trimmed.slice(0, 256) : trimmed;
};

const findTraceHeader = (headers = {}) => {
  for (const key of TRACE_HEADERS) {
    // eslint-disable-next-line security/detect-object-injection -- header lookup is constant list
    const value = normalizeHeaderValue(headers?.[key]);
    if (value) return { value, header: key };
  }
  return { value: null, header: null };
};

export function ensureCopilotTraceContext(req, res) {
  if (!res) return { id: nanoid(), source: "generated", header: null };
  res.locals = res.locals || {};
  const locals = res.locals;

  // eslint-disable-next-line security/detect-object-injection -- symbol-based local metadata
  const existing = locals.copilot_trace_id || locals[COPILOT_TRACE_KEY];
  if (existing) {
    return {
      id: existing,
      source: locals.copilot_trace_source || "existing",
      header: locals.copilot_trace_header || null,
    };
  }

  const { value, header } = findTraceHeader(req?.headers || {});
  const id = value || nanoid();
  const source = value ? "header" : "generated";

  // eslint-disable-next-line security/detect-object-injection -- symbol-based local metadata
  locals[COPILOT_TRACE_KEY] = id;
  locals.copilot_trace_id = id;
  locals.copilot_trace_source = source;
  locals.copilot_trace_header = header;
  res.locals = locals;
  return { id, source, header };
}

export function ensureCopilotTraceId(req, res) {
  return ensureCopilotTraceContext(req, res).id;
}
