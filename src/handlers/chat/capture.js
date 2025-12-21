import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { config as CFG } from "../../config/index.js";
import { ensureCopilotTraceContext } from "../../lib/trace-ids.js";

const REDACTED = "<redacted>";
const CAPTURE_ID_HEADER = "x-proxy-capture-id";
const DEFAULT_CAPTURE_DIR = path.join(process.cwd(), "test-results", "chat-copilot", "raw");
const DEFAULT_RAW_CAPTURE_DIR = path.join(
  process.cwd(),
  "test-results",
  "chat-copilot",
  "raw-unredacted"
);
const SAFE_STRING_KEYS = new Set(["model", "type", "role", "name", "status", "finish_reason"]);
const SAFE_HEADER_VALUE_KEYS = new Set([
  "user-agent",
  "content-type",
  "accept",
  "x-proxy-output-mode",
  "x-proxy-trace-id",
]);
const HEADER_ALLOWLIST = new Set([
  "user-agent",
  "content-type",
  "accept",
  "x-proxy-output-mode",
  "x-proxy-trace-id",
  "x-copilot-trace-id",
  "x-trace-id",
  "x-request-id",
  "x-proxy-capture-id",
]);
const RAW_SECRET_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "x-proxy-api-key",
  "x-forwarded-authorization",
  "cookie",
  "set-cookie",
  "x-codex-key",
]);

const isPlainObject = (value) =>
  value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value);

const sanitizeCaptureId = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

const sanitizeString = (value, key) => {
  if (value === null || value === undefined) return value;
  if (typeof value !== "string") return value;
  if (!value) return value;
  return SAFE_STRING_KEYS.has(key) ? value : REDACTED;
};

const sanitizeValue = (value, key = "") => {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return sanitizeString(value, key);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((entry) => sanitizeValue(entry, key));
  if (!isPlainObject(value)) return value;
  if (key === "metadata") {
    const redacted = {};
    for (const entryKey of Object.keys(value)) {
      redacted[entryKey] = REDACTED;
    }
    return redacted;
  }
  const next = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    next[entryKey] = sanitizeValue(entryValue, entryKey);
  }
  return next;
};

const sanitizeHeaderValue = (key, value) => {
  const normalized = String(value || "")
    .replace(/[\r\n]+/g, " ")
    .trim();
  if (!normalized) return normalized;
  if (SAFE_HEADER_VALUE_KEYS.has(key)) return normalized.slice(0, 256);
  return REDACTED;
};

const sanitizeHeaders = (headers) => {
  if (!headers || typeof headers !== "object") return {};
  const result = {};
  for (const [rawKey, rawValue] of Object.entries(headers)) {
    const key = String(rawKey || "")
      .toLowerCase()
      .trim();
    if (!key || !HEADER_ALLOWLIST.has(key)) continue;
    result[key] = Array.isArray(rawValue)
      ? rawValue.map((value) => sanitizeHeaderValue(key, value))
      : sanitizeHeaderValue(key, rawValue);
  }
  return result;
};

const sanitizeRawHeaderValue = (key, value) => {
  const normalized = String(value || "")
    .replace(/[\r\n]+/g, " ")
    .trim();
  if (!normalized) return normalized;
  if (RAW_SECRET_HEADERS.has(key)) return REDACTED;
  return normalized;
};

const sanitizeHeadersRaw = (headers) => {
  if (!headers || typeof headers !== "object") return {};
  const result = {};
  for (const [rawKey, rawValue] of Object.entries(headers)) {
    const key = String(rawKey || "")
      .toLowerCase()
      .trim();
    if (!key) continue;
    result[key] = Array.isArray(rawValue)
      ? rawValue.map((value) => sanitizeRawHeaderValue(key, value))
      : sanitizeRawHeaderValue(key, rawValue);
  }
  return result;
};

const scanTextForUseTool = (text) => {
  if (!text || typeof text !== "string") return false;
  return text.toLowerCase().includes("<use_tool");
};

const scanValueForUseTool = (value, state, depth = 0) => {
  if (state.hasUseToolTag || depth > 5) return;
  if (typeof value === "string") {
    if (scanTextForUseTool(value)) state.hasUseToolTag = true;
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      scanValueForUseTool(entry, state, depth + 1);
      if (state.hasUseToolTag) return;
    }
    return;
  }
  if (!isPlainObject(value)) return;
  if (value.content !== undefined) scanValueForUseTool(value.content, state, depth + 1);
  if (value.text !== undefined) scanValueForUseTool(value.text, state, depth + 1);
};

const summarizeChatIngress = (body = {}) => {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const roles = new Set();
  const markerState = { hasUseToolTag: false };
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    if (typeof message.role === "string" && message.role.trim()) {
      roles.add(message.role.trim().toLowerCase());
    }
    scanValueForUseTool(message.content, markerState);
  }
  return {
    message_count: messages.length,
    message_roles: Array.from(roles).slice(0, 10),
    has_tools: Array.isArray(body?.tools) && body.tools.length > 0,
    has_tool_choice: body?.tool_choice !== undefined,
    has_functions: Array.isArray(body?.functions) && body.functions.length > 0,
    has_function_call: body?.function_call !== undefined,
    has_stream_options: body?.stream_options !== undefined,
    has_use_tool_tag: markerState.hasUseToolTag,
  };
};

const buildCaptureMetadata = ({
  req,
  res,
  captureId,
  outputModeEffective,
  requestBody,
  stream,
  outcome,
} = {}) => ({
  captured_at: new Date().toISOString(),
  scenario: captureId,
  stream: Boolean(stream),
  outcome: outcome || null,
  route: res?.locals?.routeOverride || "/v1/chat/completions",
  mode: res?.locals?.modeOverride || res?.locals?.mode || null,
  endpoint_mode: res?.locals?.endpoint_mode || "chat",
  output_mode_effective: outputModeEffective ?? res?.locals?.output_mode_effective ?? null,
  proxy_trace_id: res?.locals?.req_id || null,
  copilot_trace_source: res?.locals?.copilot_trace_source || null,
  copilot_trace_header: res?.locals?.copilot_trace_header || null,
  copilot_trace_present: Boolean(res?.locals?.copilot_trace_id),
  ingress_summary: summarizeChatIngress(requestBody),
});

const resolveCaptureId = (req, suffix) => {
  const headers = req?.headers || {};
  const headerValue = headers[CAPTURE_ID_HEADER];
  const base =
    sanitizeCaptureId(headerValue) ||
    sanitizeCaptureId(`chat-${new Date().toISOString()}-${crypto.randomUUID()}`);
  if (!suffix) return base;
  return sanitizeCaptureId(`${base}-${suffix}`) || base;
};

const resolveCaptureDir = () =>
  CFG.PROXY_CAPTURE_CHAT_DIR ? String(CFG.PROXY_CAPTURE_CHAT_DIR) : DEFAULT_CAPTURE_DIR;

const resolveRawCaptureDir = () =>
  CFG.PROXY_CAPTURE_CHAT_RAW_DIR
    ? String(CFG.PROXY_CAPTURE_CHAT_RAW_DIR)
    : DEFAULT_RAW_CAPTURE_DIR;

const writeCaptureFile = async (dir, filename, payload) => {
  const target = path.join(dir, filename);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return target;
};

const shouldCapture = () => Boolean(CFG.PROXY_CAPTURE_CHAT_TRANSCRIPTS);
const shouldCaptureRaw = () => Boolean(CFG.PROXY_CAPTURE_CHAT_RAW_TRANSCRIPTS);

export const captureChatNonStream = ({
  req,
  res,
  requestBody,
  responseBody,
  outputModeEffective,
} = {}) => {
  if (!shouldCapture() && !shouldCaptureRaw()) return;
  const captureId = resolveCaptureId(req, "nonstream");
  const metadata = buildCaptureMetadata({
    req,
    res,
    captureId,
    outputModeEffective,
    requestBody,
    stream: false,
    outcome: "completed",
  });
  if (shouldCapture()) {
    const payload = {
      metadata,
      request: {
        headers: sanitizeHeaders(req?.headers),
        body: sanitizeValue(requestBody),
      },
      response: sanitizeValue(responseBody),
    };
    writeCaptureFile(resolveCaptureDir(), `${captureId}.json`, payload).catch(() => {});
  }
  if (shouldCaptureRaw()) {
    const payload = {
      metadata,
      request: {
        headers: sanitizeHeadersRaw(req?.headers),
        body: requestBody ?? null,
      },
      response: responseBody ?? null,
    };
    writeCaptureFile(resolveRawCaptureDir(), `${captureId}.json`, payload).catch(() => {});
  }
};

export const createChatStreamCapture = ({
  req,
  res,
  requestBody,
  outputModeEffective,
} = {}) => {
  if (!shouldCapture() && !shouldCaptureRaw()) return null;
  const captureId = resolveCaptureId(req, "stream");
  const entries = shouldCapture() ? [] : null;
  const rawEntries = shouldCaptureRaw() ? [] : null;
  const baseMetadata = buildCaptureMetadata({
    req,
    res,
    captureId,
    outputModeEffective,
    requestBody,
    stream: true,
  });

  const record = (payload) => {
    if (entries) {
      entries.push({
        type: "data",
        data: sanitizeValue(payload),
      });
    }
    if (rawEntries) {
      rawEntries.push({
        type: "data",
        data: payload ?? null,
      });
    }
  };

  const recordDone = () => {
    if (entries) entries.push({ type: "done" });
    if (rawEntries) rawEntries.push({ type: "done" });
  };

  const finalize = (outcome) => {
    const metadata = { ...baseMetadata, outcome: outcome || null };
    if (entries) {
      const payload = {
        metadata,
        request: {
          headers: sanitizeHeaders(req?.headers),
          body: sanitizeValue(requestBody),
        },
        stream: entries,
      };
      writeCaptureFile(resolveCaptureDir(), `${captureId}.json`, payload).catch(() => {});
    }
    if (rawEntries) {
      const payload = {
        metadata,
        request: {
          headers: sanitizeHeadersRaw(req?.headers),
          body: requestBody ?? null,
        },
        stream: rawEntries,
      };
      writeCaptureFile(resolveRawCaptureDir(), `${captureId}.json`, payload).catch(() => {});
    }
  };

  if (req && res) {
    ensureCopilotTraceContext(req, res);
  }

  return { record, recordDone, finalize };
};
