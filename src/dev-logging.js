// Dev logging and parser utilities for Codex OpenAI-compatible proxy
// ESM module
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

const appendJsonLine = (filePath, obj = {}) => {
  try {
    const payload = JSON.stringify(obj) + "\n";
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- internal file path; not user controlled
    fs.appendFile(filePath, payload, { encoding: "utf8" }, () => {});
  } catch {}
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
export const extractUseToolBlocks = (text = "", startAt = 0) => {
  const blocks = [];
  let pos = Math.max(0, Number(startAt) || 0);
  const openTag = "<use_tool"; // allow attributes
  const closeTag = "</use_tool>";
  while (pos < text.length) {
    const open = text.indexOf(openTag, pos);
    if (open < 0) break;
    const close = text.indexOf(closeTag, open);
    if (close < 0) break;
    const end = close + closeTag.length;
    const raw = text.slice(open, end);
    const getInner = (tag) => {
      // eslint-disable-next-line security/detect-non-literal-regexp -- pattern built from fixed tag names only
      const m = raw.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
      return (m && String(m[1] || "").trim()) || "";
    };
    let name = getInner("name");
    try {
      if (!name) {
        const openEnd = raw.indexOf(">", 0);
        const head = openEnd >= 0 ? raw.slice(0, openEnd + 1) : raw;
        const mAttr = head.match(/name\s*=\s*"([^"]+)"|name\s*=\s*'([^']+)'/);
        name = (mAttr && (mAttr[1] || mAttr[2])) || "";
      }
    } catch {}
    let pathStr = getInner("path");
    let queryStr = getInner("query");
    try {
      const innerStart = raw.indexOf(">", 0) + 1;
      const inner = raw.slice(innerStart, raw.length - closeTag.length).trim();
      if (!pathStr || !queryStr) {
        const maybe = inner.match(/\{[\s\S]*\}/);
        if (maybe) {
          const obj = JSON.parse(maybe[0]);
          if (obj && typeof obj === "object") {
            if (!pathStr && typeof obj.path === "string") pathStr = obj.path;
            if (!queryStr && typeof obj.query === "string") queryStr = obj.query;
          }
        }
      }
    } catch {}
    blocks.push({ raw, start: open, end, name, path: pathStr, query: queryStr });
    pos = end;
  }
  return { blocks, nextPos: pos };
};
