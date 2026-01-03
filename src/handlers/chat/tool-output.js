import { config as CFG } from "../../config/index.js";
import { extractUseToolBlocks } from "../../dev-logging.js";
import { toObsidianXml } from "../../lib/tool-call-aggregator.js";

export const getToolOutputOptions = () => ({
  maxBlocks: Number(CFG.PROXY_TOOL_BLOCK_MAX || 0),
  dedupe: !!CFG.PROXY_TOOL_BLOCK_DEDUP,
  delimiter:
    typeof CFG.PROXY_TOOL_BLOCK_DELIMITER === "string" ? CFG.PROXY_TOOL_BLOCK_DELIMITER : "",
});

const fingerprintToolCall = (record) => {
  if (!record || typeof record !== "object") return null;
  if (record.id && typeof record.id === "string") return `id:${record.id}`;
  const fn = record.function && typeof record.function === "object" ? record.function : {};
  const name = typeof fn.name === "string" ? fn.name : "";
  const args = typeof fn.arguments === "string" ? fn.arguments : "";
  return `fn:${name}:${args}`;
};

export const normalizeToolCallSnapshot = (snapshot = [], options = getToolOutputOptions()) => {
  const list = Array.isArray(snapshot) ? snapshot.slice() : [];
  const dedupe = !!options.dedupe;
  const maxBlocks = Number(options.maxBlocks || 0);
  let next = list;
  if (dedupe && next.length) {
    const seen = new Set();
    next = next.filter((record) => {
      const fingerprint = fingerprintToolCall(record);
      if (!fingerprint) return true;
      if (seen.has(fingerprint)) return false;
      seen.add(fingerprint);
      return true;
    });
  }
  const truncated = maxBlocks > 0 && next.length > maxBlocks;
  const records = truncated ? next.slice(0, maxBlocks) : next;
  return { records, truncated, observedCount: next.length };
};

const joinToolBlocks = (blocks = [], delimiter = "") => {
  if (!blocks.length) return null;
  if (!delimiter) return blocks.join("");
  return blocks.join(delimiter);
};

export const buildObsidianXmlRecord = (record = null, { toXml = toObsidianXml } = {}) => {
  if (!record) return null;
  const args = record?.function?.arguments || "";
  if (!args) return null;
  try {
    JSON.parse(args);
  } catch {
    return null;
  }
  return toXml(record);
};

export const buildCanonicalXml = (snapshot = [], options = getToolOutputOptions()) => {
  if (!Array.isArray(snapshot) || !snapshot.length) return null;
  const { records } = normalizeToolCallSnapshot(snapshot, options);
  const xmlBlocks = [];
  for (const record of records) {
    const xml = buildObsidianXmlRecord(record, { toXml: options.toXml || toObsidianXml });
    if (xml) xmlBlocks.push(xml);
  }
  return joinToolBlocks(xmlBlocks, options.delimiter || "");
};

export const extractTextualUseToolBlock = (text, options = getToolOutputOptions()) => {
  if (!text || !text.length) return null;
  try {
    const extractBlocks = options.extractBlocks || extractUseToolBlocks;
    const { blocks } = extractBlocks(text, 0);
    if (!blocks || !blocks.length) return null;
    const seen = options.dedupe ? new Set() : null;
    const results = [];
    for (const block of blocks) {
      const start = Number.isInteger(block.start)
        ? block.start
        : Number.isInteger(block.indexStart)
          ? block.indexStart
          : 0;
      const end = Number.isInteger(block.end)
        ? block.end
        : Number.isInteger(block.indexEnd)
          ? block.indexEnd
          : text.length;
      const literal = text.slice(start, end);
      if (!literal) continue;
      if (seen) {
        if (seen.has(literal)) continue;
        seen.add(literal);
      }
      results.push(literal);
    }
    return joinToolBlocks(results, options.delimiter || "");
  } catch (err) {
    if (typeof options.logError === "function") {
      options.logError(err);
    }
    return null;
  }
};

export const trimTrailingTextAfterToolBlocks = (content = "") => {
  if (!content || typeof content !== "string") return content;
  const lastClose = content.lastIndexOf("</use_tool>");
  if (lastClose === -1) return content;
  return content.slice(0, lastClose + "</use_tool>".length).trim();
};
