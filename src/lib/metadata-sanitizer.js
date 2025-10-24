const DEFAULT_METADATA_KEYS = new Set(["rollout_path", "session_id"]);

const normalizeMetadataKey = (key) => {
  if (key === null || key === undefined) return "";
  return String(key)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
};

const ensureString = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const keyFromLine = (line) => {
  const normalized = line.trimStart();
  const directMatch = normalized.match(/^"?([A-Za-z0-9._-]+)"?\s*[:=]/);
  if (directMatch && directMatch[1]) return normalizeMetadataKey(directMatch[1]);
  const jsonMatch = line.match(/"([^"]+)"\s*:\s*/);
  if (jsonMatch && jsonMatch[1]) return normalizeMetadataKey(jsonMatch[1]);
  return "";
};

const extractValueFromLine = (line) => {
  const colonIdx = line.indexOf(":");
  const equalsIdx = line.indexOf("=");
  const idx = colonIdx >= 0 ? colonIdx : equalsIdx;
  if (idx >= 0) {
    const raw = line.slice(idx + 1).trim();
    return raw.replace(/^['"]|['"]$/g, "");
  }
  const jsonMatch = line.match(/"[^"]+"\s*:\s*"([^"]*)"/);
  if (jsonMatch && jsonMatch[1]) return jsonMatch[1];
  return "";
};

const parseMetadataJson = (text, knownKeys) => {
  let candidate = text.trim();
  const metadataMatch = candidate.match(/^metadata\s*:\s*(\{.*\})$/i);
  if (metadataMatch) candidate = metadataMatch[1];
  if (!candidate.startsWith("{") || !candidate.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(candidate);
    const entries = [];
    const visit = (obj) => {
      if (!obj || typeof obj !== "object") return;
      for (const [rawKey, rawValue] of Object.entries(obj)) {
        const normalized = normalizeMetadataKey(rawKey);
        if (!normalized) continue;
        knownKeys.add(normalized);
        entries.push({
          key: normalized,
          raw: candidate,
          value: ensureString(rawValue),
        });
      }
    };
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      if (parsed.metadata && typeof parsed.metadata === "object") {
        visit(parsed.metadata);
      } else {
        visit(parsed);
      }
    }
    return entries.length ? entries : null;
  } catch {
    return null;
  }
};

const lineMatchesEntry = (line, entry) => {
  const trimmed = line.trim();
  if (!trimmed) return false;
  const candidateKey = keyFromLine(trimmed);
  if (candidateKey && candidateKey === entry.key) {
    if (!entry.value) return true;
    return trimmed.includes(entry.value) || /[:=]/.test(trimmed);
  }
  const normalizedLine = trimmed.toLowerCase();
  const normalizedKey = entry.key;
  const keyTokens = [
    `${normalizedKey}:`,
    `${normalizedKey}=`,
    `"${normalizedKey}":`,
    `'${normalizedKey}':`,
  ];
  const hasKeyToken = keyTokens.some((token) => normalizedLine.includes(token));
  if (!hasKeyToken) return false;
  if (!entry.value) return /[:=]/.test(trimmed);
  const valueLower = entry.value.toLowerCase();
  return valueLower ? normalizedLine.includes(valueLower) : /[:=]/.test(trimmed);
};

const lineMatchesKnownKey = (line, key) => {
  const candidateKey = keyFromLine(line);
  if (candidateKey) return candidateKey === key;
  const normalizedLine = line.trim().toLowerCase();
  const keyTokens = [`${key}:`, `${key}=`, `"${key}":`, `'${key}':`];
  return keyTokens.some((token) => normalizedLine.includes(token));
};

const evaluateLine = (line, metadataEntries, knownKeys) => {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const jsonEntries = parseMetadataJson(trimmed, knownKeys);
  if (jsonEntries && jsonEntries.length) {
    return jsonEntries.map((entry) => ({
      key: entry.key,
      raw: trimmed,
      value: entry.value,
    }));
  }
  for (const entry of metadataEntries) {
    if (lineMatchesEntry(line, entry)) {
      return [
        {
          key: entry.key,
          raw: line.trim(),
          value: entry.value,
        },
      ];
    }
  }
  for (const key of knownKeys) {
    if (lineMatchesKnownKey(line, key)) {
      return [
        {
          key,
          raw: line.trim(),
          value: extractValueFromLine(line),
        },
      ];
    }
  }
  return null;
};

const addCandidateMetadata = (candidate, source, out) => {
  if (!candidate || typeof candidate !== "object") return;
  const entries = Object.entries(candidate);
  if (!entries.length) return;
  for (const [rawKey, rawValue] of entries) {
    const key = normalizeMetadataKey(rawKey);
    if (!key) continue;
    out.metadata.set(key, ensureString(rawValue));
    out.sources.add(source);
  }
};

const processContentCandidate = (candidate, source, out) => {
  if (!Array.isArray(candidate)) return;
  for (const item of candidate) {
    if (!item || typeof item !== "object") continue;
    if (item.metadata && typeof item.metadata === "object") {
      addCandidateMetadata(item.metadata, `${source}.metadata`, out);
    }
  }
};

export const extractMetadataFromPayload = (payload) => {
  if (!payload || typeof payload !== "object") return null;
  const acc = { metadata: new Map(), sources: new Set() };
  addCandidateMetadata(payload.metadata, "payload.metadata", acc);
  addCandidateMetadata(payload.msg?.metadata, "msg.metadata", acc);
  addCandidateMetadata(payload.message?.metadata, "message.metadata", acc);
  addCandidateMetadata(payload.msg?.message?.metadata, "msg.message.metadata", acc);
  addCandidateMetadata(payload.delta?.metadata, "delta.metadata", acc);
  addCandidateMetadata(payload.msg?.delta?.metadata, "msg.delta.metadata", acc);
  processContentCandidate(payload.content, "payload.content", acc);
  processContentCandidate(payload.message?.content, "message.content", acc);
  processContentCandidate(payload.msg?.message?.content, "msg.message.content", acc);
  processContentCandidate(payload.delta?.content, "delta.content", acc);
  processContentCandidate(payload.msg?.delta?.content, "msg.delta.content", acc);
  const keys = Array.from(acc.metadata.keys());
  if (!keys.length) return null;
  return {
    metadata: Object.fromEntries(acc.metadata.entries()),
    sources: Array.from(acc.sources),
  };
};

export const sanitizeMetadataTextSegment = (text, metadata = {}) => {
  const segment = typeof text === "string" ? text : String(text ?? "");
  if (!segment) {
    return { text: segment, removed: [] };
  }
  const metadataEntries = Object.entries(metadata || {})
    .map(([rawKey, rawValue]) => ({
      key: normalizeMetadataKey(rawKey),
      value: ensureString(rawValue),
    }))
    .filter((entry) => entry.key);
  const knownKeys = new Set([...DEFAULT_METADATA_KEYS]);
  for (const entry of metadataEntries) knownKeys.add(entry.key);
  const parts = segment.split(/(\r?\n)/);
  const sanitizedParts = [];
  const removed = [];
  /* eslint-disable security/detect-object-injection */
  for (let idx = 0; idx < parts.length; idx += 2) {
    const line = parts[idx];
    const newline = parts[idx + 1] ?? "";
    if (line === undefined) break;
    const removal = evaluateLine(line, metadataEntries, knownKeys);
    if (removal && removal.length) {
      removed.push(...removal);
      continue;
    }
    sanitizedParts.push(line);
    if (newline) sanitizedParts.push(newline);
  }
  /* eslint-enable security/detect-object-injection */
  let sanitizedText = sanitizedParts.join("");
  if (removed.length && /\n$/.test(sanitizedText)) {
    sanitizedText = sanitizedText.replace(/\n+$/g, "");
  }
  return { text: sanitizedText, removed };
};

export const metadataKeys = () => Array.from(DEFAULT_METADATA_KEYS);

export { normalizeMetadataKey };
