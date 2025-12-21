import { sha256 } from "../../services/logging/schema.js";

const MAX_ITEMS = 20;

const normalizeText = (value) => (typeof value === "string" ? value : "");

const containsUseTool = (text) => text.toLowerCase().includes("<use_tool");

export const summarizeText = (text) => {
  const normalized = normalizeText(text);
  const bytes = Buffer.byteLength(normalized, "utf8");
  return {
    output_text_bytes: bytes,
    output_text_hash: normalized ? sha256(normalized) : null,
    xml_in_text: containsUseTool(normalized),
  };
};

export const summarizeTextParts = (parts = []) => {
  const text = Array.isArray(parts) ? parts.filter((part) => typeof part === "string").join("") : "";
  return summarizeText(text);
};

export const summarizeToolCalls = (toolCalls = [], { maxItems = MAX_ITEMS } = {}) => {
  const calls = Array.isArray(toolCalls) ? toolCalls : [];
  const names = [];
  const argsHashes = [];
  const argsBytes = [];

  for (const call of calls.slice(0, maxItems)) {
    if (!call || typeof call !== "object") continue;
    const fn = call.function && typeof call.function === "object" ? call.function : {};
    if (typeof fn.name === "string" && fn.name.trim()) {
      names.push(fn.name.trim());
    }
    const args = typeof fn.arguments === "string" ? fn.arguments : "";
    if (args) {
      argsHashes.push(sha256(args));
      argsBytes.push(Buffer.byteLength(args, "utf8"));
    }
  }

  const uniqueNames = Array.from(new Set(names)).sort();
  return {
    tool_call_count: calls.length,
    tool_names: uniqueNames.slice(0, maxItems),
    tool_names_truncated: uniqueNames.length > maxItems,
    tool_args_hashes: argsHashes,
    tool_args_bytes: argsBytes,
    tool_args_truncated: calls.length > maxItems,
  };
};

export const summarizeToolUseItems = (output = [], { maxItems = MAX_ITEMS } = {}) => {
  const names = [];
  let count = 0;
  if (!Array.isArray(output)) {
    return { tool_use_count: 0, tool_use_names: [] };
  }

  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const contentItem of item.content) {
        if (!contentItem || typeof contentItem !== "object") continue;
        if (contentItem.type === "tool_use") {
          count += 1;
          if (typeof contentItem.name === "string" && contentItem.name.trim()) {
            names.push(contentItem.name.trim());
          }
        }
      }
    }
  }

  const uniqueNames = Array.from(new Set(names)).sort();
  return {
    tool_use_count: count,
    tool_use_names: uniqueNames.slice(0, maxItems),
    tool_use_names_truncated: uniqueNames.length > maxItems,
  };
};
