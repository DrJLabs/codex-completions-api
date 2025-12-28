const REDACTED = "<redacted>";
const SENSITIVE_STRING_KEYS = new Set([
  "auth_url",
  "authurl",
  "login_url",
  "loginurl",
  "login_id",
  "loginid",
]);
const INLINE_AUTH_PATTERN = /\b(auth_url|login_url|login_id)=([^\s|,]+)/gi;

const DEFAULT_SAFE_HEADER_VALUE_KEYS = new Set([
  "user-agent",
  "content-type",
  "accept",
  "x-proxy-output-mode",
  "x-proxy-trace-id",
]);

const DEFAULT_HEADER_ALLOWLIST = new Set([
  "user-agent",
  "content-type",
  "accept",
  "x-proxy-output-mode",
  "x-copilot-trace-id",
  "x-trace-id",
  "x-request-id",
  "x-proxy-trace-id",
  "x-proxy-capture-id",
]);

const DEFAULT_RAW_SECRET_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "x-proxy-api-key",
  "x-forwarded-authorization",
  "cookie",
  "set-cookie",
  "x-codex-key",
]);

export const isPlainObject = (value) =>
  value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value);

export const sanitizeCaptureId = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

const normalizeHeaderValue = (value) =>
  String(value || "")
    .replace(/[\r\n]+/g, " ")
    .trim();

export const createCaptureSanitizers = ({
  safeStringKeys,
  safeHeaderValueKeys = DEFAULT_SAFE_HEADER_VALUE_KEYS,
  headerAllowlist = DEFAULT_HEADER_ALLOWLIST,
  rawSecretHeaders = DEFAULT_RAW_SECRET_HEADERS,
} = {}) => {
  const safeStrings = safeStringKeys instanceof Set ? safeStringKeys : new Set();
  const safeHeaderValues = safeHeaderValueKeys instanceof Set ? safeHeaderValueKeys : new Set();
  const headerAllow = headerAllowlist instanceof Set ? headerAllowlist : new Set();
  const rawSecrets = rawSecretHeaders instanceof Set ? rawSecretHeaders : new Set();

  const redactInlineAuth = (value) =>
    value.replace(INLINE_AUTH_PATTERN, (_match, field) => `${field}=${REDACTED}`);

  const sanitizeString = (value, key) => {
    if (value === null || value === undefined) return value;
    if (typeof value !== "string") return value;
    if (!value) return value;
    const normalizedKey = String(key || "").toLowerCase();
    if (normalizedKey && SENSITIVE_STRING_KEYS.has(normalizedKey)) return REDACTED;
    return safeStrings.has(key) ? redactInlineAuth(value) : REDACTED;
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
        // eslint-disable-next-line security/detect-object-injection -- redact known metadata keys
        redacted[entryKey] = REDACTED;
      }
      return redacted;
    }
    const next = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      // eslint-disable-next-line security/detect-object-injection -- sanitize nested keys
      next[entryKey] = sanitizeValue(entryValue, entryKey);
    }
    return next;
  };

  const sanitizeHeaderValue = (key, value) => {
    const normalized = normalizeHeaderValue(value);
    if (!normalized) return normalized;
    if (safeHeaderValues.has(key)) return normalized.slice(0, 256);
    return REDACTED;
  };

  const sanitizeHeaders = (headers) => {
    if (!headers || typeof headers !== "object") return {};
    const result = {};
    for (const [rawKey, rawValue] of Object.entries(headers)) {
      const key = String(rawKey || "")
        .toLowerCase()
        .trim();
      if (!key || !headerAllow.has(key)) continue;
      // eslint-disable-next-line security/detect-object-injection -- normalized header keys
      result[key] = Array.isArray(rawValue)
        ? rawValue.map((value) => sanitizeHeaderValue(key, value))
        : sanitizeHeaderValue(key, rawValue);
    }
    return result;
  };

  const sanitizeRawHeaderValue = (key, value) => {
    const normalized = normalizeHeaderValue(value);
    if (!normalized) return normalized;
    if (rawSecrets.has(key)) return REDACTED;
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
      // eslint-disable-next-line security/detect-object-injection -- normalized header keys
      result[key] = Array.isArray(rawValue)
        ? rawValue.map((value) => sanitizeRawHeaderValue(key, value))
        : sanitizeRawHeaderValue(key, rawValue);
    }
    return result;
  };

  return { sanitizeValue, sanitizeHeaders, sanitizeHeadersRaw };
};

export { DEFAULT_HEADER_ALLOWLIST, DEFAULT_RAW_SECRET_HEADERS, DEFAULT_SAFE_HEADER_VALUE_KEYS };
