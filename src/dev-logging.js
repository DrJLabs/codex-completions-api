// Dev logging and parser utilities for Codex OpenAI-compatible proxy
// ESM module
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractUseToolBlocks as toolCallBlockParser } from "./lib/tool-call-aggregator.js";

export const extractUseToolBlocks = toolCallBlockParser;

const IS_DEV_ENV = (process.env.PROXY_ENV || "").toLowerCase() === "dev";
const DEFAULT_SANITIZER_LOG_NAME = "codex-sanitizer.ndjson";
const SANITIZER_LOG_BASE_DIR = path.resolve(process.env.SANITIZER_LOG_BASE_DIR || os.tmpdir());

const resolveSanitizerLogPath = (envValue) => {
  const fallback = path.join(SANITIZER_LOG_BASE_DIR, DEFAULT_SANITIZER_LOG_NAME);
  if (!envValue) return fallback;

  const candidate = path.resolve(SANITIZER_LOG_BASE_DIR, envValue);
  const relative = path.relative(SANITIZER_LOG_BASE_DIR, candidate);
  const escapesBase = relative.startsWith("..");

  if (escapesBase) {
    process.emitWarning(
      `Ignoring unsafe sanitizer log path outside ${SANITIZER_LOG_BASE_DIR}: ${envValue}`,
      { code: "CODEX_SANITIZER_LOG_OUTSIDE_BASE" }
    );
    return fallback;
  }

  return candidate;
};

export const TOKEN_LOG_PATH =
  process.env.TOKEN_LOG_PATH || path.join(os.tmpdir(), "codex-usage.ndjson");
export const PROTO_LOG_PATH =
  process.env.PROTO_LOG_PATH || path.join(os.tmpdir(), "codex-proto-events.ndjson");
export const SANITIZER_LOG_PATH = resolveSanitizerLogPath(process.env.SANITIZER_LOG_PATH);
export const LOG_PROTO =
  IS_DEV_ENV && String(process.env.PROXY_LOG_PROTO || "true").toLowerCase() !== "false";

// Ensure directories exist on module load
try {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- directories derived from env/tmpdir
  fs.mkdirSync(path.dirname(TOKEN_LOG_PATH), { recursive: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- directories derived from env/tmpdir
  fs.mkdirSync(path.dirname(PROTO_LOG_PATH), { recursive: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- directories derived from env/tmpdir
  fs.mkdirSync(path.dirname(SANITIZER_LOG_PATH), { recursive: true });
} catch {}

const appendQueues = new Map();

const appendJsonLine = (filePath, obj = {}) => {
  let payload;
  try {
    payload = JSON.stringify(obj) + "\n";
  } catch (err) {
    try {
      console.error(`[dev-logging] JSON stringify failed for ${filePath}:`, err);
      process.emitWarning(
        `appendJsonLine stringify failed for ${filePath}: ${String(err?.message || err)}`,
        { code: "CODEX_APPEND_STRINGIFY_FAILURE" }
      );
    } catch {}
    return Promise.resolve();
  }

  const previous = appendQueues.get(filePath) || Promise.resolve();
  const appendTask = () =>
    new Promise((resolve) => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- internal file path; not user controlled
      fs.appendFile(filePath, payload, { encoding: "utf8" }, (err) => {
        if (err) {
          try {
            console.error(`[dev-logging] Failed to append to ${filePath}:`, err);
            process.emitWarning(
              `appendJsonLine failed for ${filePath}: ${String(err?.message || err)}`,
              { code: "CODEX_APPEND_FAILURE" }
            );
          } catch {}
        }
        resolve();
      });
    });
  const next = previous.then(() => appendTask());
  const tracked = next.finally(() => {
    if (appendQueues.get(filePath) === tracked) {
      appendQueues.delete(filePath);
    }
  });
  appendQueues.set(filePath, tracked);
  return tracked;
};

export const __whenAppendIdle = (filePath) => {
  if (filePath) {
    const pending = appendQueues.get(filePath);
    return pending ? pending.then(() => undefined) : Promise.resolve();
  }
  return Promise.all(Array.from(appendQueues.values())).then(() => undefined);
};

export const appendUsage = (obj = {}) => {
  appendJsonLine(TOKEN_LOG_PATH, obj);
};

export const appendProtoEvent = (obj = {}) => {
  if (!LOG_PROTO) return;
  appendJsonLine(PROTO_LOG_PATH, obj);
};

const sanitizerState = {
  lastEnabled: undefined,
};

export const logSanitizerToggle = ({
  enabled,
  trigger = "request",
  route = "/v1/chat/completions",
  mode,
  reqId,
} = {}) => {
  const normalized = Boolean(enabled);
  if (sanitizerState.lastEnabled === normalized) return;
  sanitizerState.lastEnabled = normalized;
  appendJsonLine(SANITIZER_LOG_PATH, {
    ts: Date.now(),
    kind: "proxy_sanitize_metadata",
    enabled: normalized,
    trigger,
    route,
    mode,
    req_id: reqId || null,
  });
};

export const logSanitizerSummary = ({
  enabled,
  route = "/v1/chat/completions",
  mode,
  reqId,
  count = 0,
  keys = [],
  sources = [],
} = {}) => {
  appendJsonLine(SANITIZER_LOG_PATH, {
    ts: Date.now(),
    kind: "metadata_sanitizer_summary",
    enabled: Boolean(enabled),
    route,
    mode,
    req_id: reqId || null,
    sanitized_count: count,
    sanitized_keys: Array.from(new Set(keys || [])),
    sanitized_sources: Array.from(new Set(sources || [])),
  });
};

export const __resetSanitizerTelemetryStateForTests = () => {
  sanitizerState.lastEnabled = undefined;
};

// Lightweight parser for <use_tool ...>...</use_tool> blocks
// Extracts: name (attribute or inner tag), path, query, start/end offsets
