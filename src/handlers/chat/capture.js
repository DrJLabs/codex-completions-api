import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { config as CFG } from "../../config/index.js";
import {
  createCaptureSanitizers,
  isPlainObject,
  sanitizeCaptureId,
} from "../../lib/capture/sanitize.js";
import { ensureCopilotTraceContext } from "../../lib/trace-ids.js";
const CAPTURE_ID_HEADER = "x-proxy-capture-id";
const DEFAULT_CAPTURE_DIR = path.join(process.cwd(), "test-results", "chat-copilot", "raw");
const DEFAULT_RAW_CAPTURE_DIR = path.join(
  process.cwd(),
  "test-results",
  "chat-copilot",
  "raw-unredacted"
);
const SAFE_STRING_KEYS = new Set(["model", "type", "role", "name", "status", "finish_reason"]);
const { sanitizeValue, sanitizeHeaders, sanitizeHeadersRaw } = createCaptureSanitizers({
  safeStringKeys: SAFE_STRING_KEYS,
});

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
  CFG.PROXY_CAPTURE_CHAT_RAW_DIR ? String(CFG.PROXY_CAPTURE_CHAT_RAW_DIR) : DEFAULT_RAW_CAPTURE_DIR;

const writeCaptureFile = async (dir, filename, payload) => {
  const target = path.join(dir, filename);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return target;
};

const writeCaptureFileSafe = (dir, filename, payload, label) => {
  writeCaptureFile(dir, filename, payload).catch((err) => {
    const message = err && typeof err === "object" ? err.message : String(err || "");
    console.error(`[capture] failed to write ${label} capture ${filename}`, message);
  });
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
    writeCaptureFileSafe(resolveCaptureDir(), `${captureId}.json`, payload, "chat nonstream");
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
    writeCaptureFileSafe(
      resolveRawCaptureDir(),
      `${captureId}.json`,
      payload,
      "chat raw nonstream"
    );
  }
};

export const createChatStreamCapture = ({ req, res, requestBody, outputModeEffective } = {}) => {
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
    const ts = Date.now();
    if (entries) {
      entries.push({
        type: "data",
        ts,
        data: sanitizeValue(payload),
      });
    }
    if (rawEntries) {
      rawEntries.push({
        type: "data",
        ts,
        data: payload ?? null,
      });
    }
  };

  const recordDone = () => {
    const ts = Date.now();
    if (entries) entries.push({ type: "done", ts });
    if (rawEntries) rawEntries.push({ type: "done", ts });
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
      writeCaptureFileSafe(resolveCaptureDir(), `${captureId}.json`, payload, "chat stream");
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
      writeCaptureFileSafe(resolveRawCaptureDir(), `${captureId}.json`, payload, "chat raw stream");
    }
  };

  if (req && res) {
    ensureCopilotTraceContext(req, res);
  }

  return { record, recordDone, finalize };
};
