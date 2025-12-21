import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { config as CFG } from "../../config/index.js";
import { createCaptureSanitizers, sanitizeCaptureId } from "../../lib/capture/sanitize.js";
import { summarizeResponsesIngress } from "./ingress-logging.js";
const CAPTURE_ID_HEADER = "x-proxy-capture-id";
const DEFAULT_CAPTURE_DIR = path.join(process.cwd(), "test-results", "responses-copilot", "raw");
const DEFAULT_RAW_CAPTURE_DIR = path.join(
  process.cwd(),
  "test-results",
  "responses-copilot",
  "raw-unredacted"
);
const SAFE_STRING_KEYS = new Set([
  "model",
  "type",
  "role",
  "name",
  "status",
  "verbosity",
  "effort",
  "mode",
  "format",
  "provider",
]);
const { sanitizeValue, sanitizeHeaders, sanitizeHeadersRaw } = createCaptureSanitizers({
  safeStringKeys: SAFE_STRING_KEYS,
});

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
  route: res?.locals?.routeOverride || "/v1/responses",
  mode: res?.locals?.modeOverride || res?.locals?.mode || null,
  endpoint_mode: res?.locals?.endpoint_mode || "responses",
  output_mode_effective: outputModeEffective ?? res?.locals?.output_mode_effective ?? null,
  proxy_trace_id: res?.locals?.req_id || null,
  copilot_trace_source: res?.locals?.copilot_trace_source || null,
  copilot_trace_header: res?.locals?.copilot_trace_header || null,
  copilot_trace_present: Boolean(res?.locals?.copilot_trace_id),
  ingress_summary: summarizeResponsesIngress(requestBody, req),
});

const resolveCaptureId = (req, suffix) => {
  const headers = req?.headers || {};
  const headerValue = headers[CAPTURE_ID_HEADER];
  const base =
    sanitizeCaptureId(headerValue) ||
    sanitizeCaptureId(`responses-${new Date().toISOString()}-${crypto.randomUUID()}`);
  if (!suffix) return base;
  return sanitizeCaptureId(`${base}-${suffix}`) || base;
};

const resolveCaptureDir = () =>
  CFG.PROXY_CAPTURE_RESPONSES_DIR ? String(CFG.PROXY_CAPTURE_RESPONSES_DIR) : DEFAULT_CAPTURE_DIR;

const resolveRawCaptureDir = () =>
  CFG.PROXY_CAPTURE_RESPONSES_RAW_DIR
    ? String(CFG.PROXY_CAPTURE_RESPONSES_RAW_DIR)
    : DEFAULT_RAW_CAPTURE_DIR;

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

const shouldCapture = () => Boolean(CFG.PROXY_CAPTURE_RESPONSES_TRANSCRIPTS);
const shouldCaptureRaw = () => Boolean(CFG.PROXY_CAPTURE_RESPONSES_RAW_TRANSCRIPTS);

export const captureResponsesNonStream = ({
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
    writeCaptureFileSafe(resolveCaptureDir(), `${captureId}.json`, payload, "responses nonstream");
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
      "responses raw nonstream"
    );
  }
};

export const createResponsesStreamCapture = ({
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

  const record = (event, payload) => {
    const ts = Date.now();
    if (event === "done" && payload === "[DONE]") {
      if (entries) entries.push({ type: "done", event, ts });
      if (rawEntries) rawEntries.push({ type: "done", event, ts });
      return;
    }
    if (entries) {
      entries.push({
        type: "data",
        event,
        ts,
        data: sanitizeValue(payload),
      });
    }
    if (rawEntries) {
      rawEntries.push({
        type: "data",
        event,
        ts,
        data: payload ?? null,
      });
    }
  };

  const finalize = (outcome = "completed") => {
    const metadata = { ...baseMetadata, outcome };
    if (entries) {
      const payload = {
        metadata,
        request: {
          headers: sanitizeHeaders(req?.headers),
          body: sanitizeValue(requestBody),
        },
        stream: entries,
      };
      writeCaptureFileSafe(resolveCaptureDir(), `${captureId}.json`, payload, "responses stream");
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
      writeCaptureFileSafe(
        resolveRawCaptureDir(),
        `${captureId}.json`,
        payload,
        "responses raw stream"
      );
    }
  };

  return { record, finalize };
};
