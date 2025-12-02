const redactKeys = new Set(["payload", "body", "headers", "messages", "response"]);

const sanitize = (entry = {}) => {
  const cleaned = { ...entry };
  for (const key of redactKeys) {
    if (key in cleaned) {
      // eslint-disable-next-line security/detect-object-injection -- keys are from fixed allowlist above
      cleaned[key] = "[redacted]";
    }
  }
  return cleaned;
};

const resolveTimestamp = (value) => {
  const tsCandidate =
    typeof value === "number" && Number.isFinite(value) ? value : Number(Date.now());
  return Number.isFinite(tsCandidate) ? tsCandidate : Date.now();
};

export const buildLogEntry = (entry = {}) => {
  const sanitized = sanitize(entry);
  const ts = resolveTimestamp(sanitized.ts_ms ?? sanitized.ts);
  return {
    ...sanitized,
    ts,
    ts_ms: ts,
    timestamp: sanitized.timestamp || new Date(ts).toISOString(),
  };
};

export const applyLogSchema = (payload = {}, canonical = {}) => {
  const sanitizedPayload = sanitize(payload);
  const merged = { ...sanitizedPayload };
  for (const [key, value] of Object.entries(canonical || {})) {
    if (value !== undefined) {
      // eslint-disable-next-line security/detect-object-injection -- canonical fields are controlled constants
      merged[key] = value;
    }
  }
  const ts = resolveTimestamp(merged.ts_ms ?? merged.ts);
  merged.ts = ts;
  merged.ts_ms = ts;
  merged.timestamp = merged.timestamp || new Date(ts).toISOString();
  return merged;
};

export const logStructured = (canonical = {}, extras = {}) => {
  const entry = applyLogSchema(extras, canonical);
  try {
    console.log(JSON.stringify(entry));
  } catch {
    // Logging is best effort; swallow serialization errors.
  }
  return entry;
};
