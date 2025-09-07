// Dev logging and parser utilities for Codex OpenAI-compatible proxy
// ESM module
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const IS_DEV_ENV = (process.env.PROXY_ENV || "").toLowerCase() === "dev";

export const TOKEN_LOG_PATH =
  process.env.TOKEN_LOG_PATH || path.join(os.tmpdir(), "codex-usage.ndjson");
export const PROTO_LOG_PATH =
  process.env.PROTO_LOG_PATH || path.join(os.tmpdir(), "codex-proto-events.ndjson");
export const LOG_PROTO =
  IS_DEV_ENV && String(process.env.PROXY_LOG_PROTO || "true").toLowerCase() !== "false";

// Ensure directories exist on module load
try {
  fs.mkdirSync(path.dirname(TOKEN_LOG_PATH), { recursive: true });
  fs.mkdirSync(path.dirname(PROTO_LOG_PATH), { recursive: true });
} catch {}

export const appendUsage = (obj = {}) => {
  try {
    fs.appendFileSync(TOKEN_LOG_PATH, JSON.stringify(obj) + "\n", { encoding: "utf8" });
  } catch {}
};

export const appendProtoEvent = (obj = {}) => {
  if (!LOG_PROTO) return;
  try {
    fs.appendFileSync(PROTO_LOG_PATH, JSON.stringify(obj) + "\n", { encoding: "utf8" });
  } catch {}
};

// Lightweight parser for <use_tool ...>...</use_tool> blocks
// Extracts: name (attribute or inner tag), path, query, start/end offsets
export const extractUseToolBlocks = (text = "", startAt = 0) => {
  const blocks = [];
  let pos = Math.max(0, Number(startAt) || 0);
  const openTag = "<use_tool"; // allow attributes
  const closeTag = "</use_tool>";
  while (true) {
    const open = text.indexOf(openTag, pos);
    if (open < 0) break;
    const close = text.indexOf(closeTag, open);
    if (close < 0) break;
    const end = close + closeTag.length;
    const raw = text.slice(open, end);
    const getInner = (tag) => {
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
