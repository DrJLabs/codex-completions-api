/*
 * security/detect-object-injection is disabled because the helpers must inspect
 * dynamic tool argument maps provided by upstream worker payloads. Each access
 * is guarded by explicit checks before use, keeping the helpers safe while
 * avoiding noisy false positives from the lint rule.
 */
/* eslint-disable security/detect-object-injection */
import { buildXmlTag, escapeXml } from "./xml.js";

const TOOL_PARAMETER_CANON = new Map([
  [
    "localSearch",
    [
      { name: "query", required: true },
      { name: "salientTerms", required: true },
      { name: "timeRange", required: false },
    ],
  ],
  [
    "webSearch",
    [
      { name: "query", required: true },
      { name: "chatHistory", required: true },
    ],
  ],
  ["getCurrentTime", [{ name: "timezoneOffset", required: false }]],
  [
    "convertTimeBetweenTimezones",
    [
      { name: "time", required: true },
      { name: "fromOffset", required: true },
      { name: "toOffset", required: true },
    ],
  ],
  ["getTimeRangeMs", [{ name: "timeExpression", required: true }]],
  ["getTimeInfoByEpoch", [{ name: "epoch", required: true }]],
  [
    "readNote",
    [
      { name: "notePath", required: true },
      { name: "chunkIndex", required: false },
    ],
  ],
  ["getFileTree", []],
  [
    "getTagList",
    [
      { name: "includeInline", required: false },
      { name: "maxEntries", required: false },
    ],
  ],
  [
    "writeToFile",
    [
      { name: "path", required: true },
      { name: "content", required: true },
    ],
  ],
  [
    "replaceInFile",
    [
      { name: "path", required: true },
      { name: "diff", required: true },
    ],
  ],
  ["updateMemory", [{ name: "statement", required: true }]],
  ["youtubeTranscription", []],
]);

function normalizeKey(key) {
  return typeof key === "string" ? key.trim() : "";
}

function formatJsonValueFromText(raw) {
  if (raw === null || raw === undefined) return '""';
  const trimmed = String(raw).trim();
  if (!trimmed) return '""';
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch {}
  }
  return JSON.stringify(trimmed);
}

export function getToolParameterSpec(toolName) {
  const normalized = typeof toolName === "string" ? toolName.trim() : "";
  return TOOL_PARAMETER_CANON.get(normalized) || [];
}

function orderKeys(toolName, fields) {
  const spec = getToolParameterSpec(toolName);
  const ordered = [];
  const seen = new Set();

  spec.forEach((entry) => {
    const key = normalizeKey(entry.name);
    if (key && Object.prototype.hasOwnProperty.call(fields, key)) {
      ordered.push(key);
      seen.add(key);
    }
  });

  Object.keys(fields)
    .filter((key) => !seen.has(key))
    .sort()
    .forEach((key) => ordered.push(key));

  return ordered;
}

export function buildCanonicalJsonFromFields(toolName, fields = {}) {
  const entries = [];
  const orderedKeys = orderKeys(toolName, fields);
  for (const key of orderedKeys) {
    const value = fields[key];
    if (value === undefined) continue;
    const formatted = formatJsonValueFromText(value);
    entries.push(`"${key}": ${formatted}`);
  }
  return `{${entries.join(", ")}}`;
}

function normalizeArgumentsObject(args) {
  if (!args || typeof args !== "object") return {};
  return args;
}

export function toObsidianXml(record, options = {}) {
  const indent = typeof options.indent === "string" ? options.indent : "  ";
  const fn = record?.function || {};
  const toolName = typeof fn.name === "string" && fn.name.trim() ? fn.name.trim() : "tool";
  const rawArgs = typeof fn.arguments === "string" ? fn.arguments : "";
  let parsedArgs = null;

  if (rawArgs) {
    try {
      parsedArgs = JSON.parse(rawArgs);
    } catch {
      parsedArgs = null;
    }
  }

  const lines = ["<use_tool>", `${indent}<name>${escapeXml(toolName)}</name>`];

  if (parsedArgs && typeof parsedArgs === "object") {
    const normalizedArgs = normalizeArgumentsObject(parsedArgs);
    const orderedKeys = orderKeys(toolName, normalizedArgs);
    for (const key of orderedKeys) {
      if (!Object.prototype.hasOwnProperty.call(normalizedArgs, key)) continue;
      lines.push(buildXmlTag(key, normalizedArgs[key], indent));
    }
    if (orderedKeys.length === 0 && rawArgs) {
      lines.push(buildXmlTag("args", rawArgs, indent));
    }
  } else if (rawArgs) {
    lines.push(buildXmlTag("args", rawArgs, indent));
  }

  lines.push("</use_tool>");
  return lines.join("\n");
}

export { TOOL_PARAMETER_CANON };
