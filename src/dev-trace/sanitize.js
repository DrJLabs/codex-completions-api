/* eslint-disable security/detect-object-injection */
const DEFAULT_BODY_LIMIT = Number(process.env.PROXY_TRACE_BODY_LIMIT || 4096);
const SECRET_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "x-proxy-api-key",
  "x-forwarded-authorization",
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "x-codex-key",
]);

const REDACTED = "[REDACTED]";
const TRUNCATION_SUFFIX = "…<truncated>";

const isPlainObject = (value) => Object.prototype.toString.call(value) === "[object Object]";

const cloneLimited = (value, limit) => {
  try {
    const json = JSON.stringify(value);
    if (typeof json === "string") {
      if (json.length <= limit) return JSON.parse(json);
      const truncated =
        json.slice(0, Math.max(0, limit - TRUNCATION_SUFFIX.length)) + TRUNCATION_SUFFIX;
      return {
        truncated: true,
        preview: truncated,
      };
    }
  } catch {}
  const stringValue = typeof value === "string" ? value : safeToString(value);
  if (stringValue.length <= limit) return stringValue;
  return stringValue.slice(0, Math.max(0, limit - TRUNCATION_SUFFIX.length)) + TRUNCATION_SUFFIX;
};

const safeToString = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export function sanitizeHeaders(headers = {}) {
  if (!headers || typeof headers !== "object") return {};
  const result = {};
  for (const [keyRaw, value] of Object.entries(headers)) {
    const key = String(keyRaw || "").toLowerCase();
    if (!key) continue;
    if (SECRET_HEADERS.has(key)) {
      result[key] = REDACTED;
      continue;
    }
    if (Array.isArray(value)) {
      result[key] = value.map((entry) => (typeof entry === "string" ? entry : safeToString(entry)));
    } else if (typeof value === "string") {
      result[key] = value;
    } else if (value === undefined || value === null) {
      result[key] = "";
    } else {
      result[key] = safeToString(value);
    }
  }
  return result;
}

export function sanitizeBody(body, { limit = DEFAULT_BODY_LIMIT } = {}) {
  if (body === undefined || body === null) return null;
  if (typeof body === "string") {
    if (body.length <= limit) return body;
    return body.slice(0, Math.max(0, limit - TRUNCATION_SUFFIX.length)) + TRUNCATION_SUFFIX;
  }
  if (Buffer.isBuffer(body)) {
    const text = body.toString("utf8");
    return sanitizeBody(text, { limit });
  }
  if (Array.isArray(body) || isPlainObject(body)) {
    return cloneLimited(body, limit);
  }
  return safeToString(body);
}

export function sanitizeRpcPayload(payload, opts = {}) {
  return sanitizeBody(payload, opts);
}
