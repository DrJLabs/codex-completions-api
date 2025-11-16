#!/usr/bin/env node
import fs from "node:fs/promises";
import process from "node:process";
import { PROTO_LOG_PATH, TOKEN_LOG_PATH } from "../../src/dev-logging.js";

function parseArgs(argv) {
  const entries = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    // eslint-disable-next-line security/detect-object-injection -- reading CLI args
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      entries.set(key, next);
      i += 1;
    } else {
      entries.set(key, "true");
    }
  }
  return Object.fromEntries(entries.entries());
}

function parseJsonLines(contents) {
  return contents
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function loadLog(pathName) {
  if (!pathName) return [];
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI-provided log path
    const contents = await fs.readFile(pathName, "utf8");
    return parseJsonLines(contents);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      console.warn(`[trace] log not found at ${pathName}`);
      return [];
    }
    console.warn(`[trace] failed to read ${pathName}:`, err?.message || err);
    return [];
  }
}

function normalizeTs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function formatEvent(event) {
  const time = new Date(event.ts).toISOString();
  const source = event.source || "proto";
  const phase = event.data?.phase || event.data?.kind || "";
  return `[${time}] [${source}] ${phase} ${JSON.stringify(event.data)}`;
}

async function main() {
  const argv = parseArgs(process.argv.slice(2));
  const reqId = argv["req-id"] || argv.reqId;
  if (!reqId) {
    console.error(
      "Usage: node scripts/dev/trace-by-req-id.js --req-id <id> [--access-log file] [--proto-log file] [--usage-log file]"
    );
    process.exit(1);
  }
  const accessPath = argv["access-log"] || process.env.ACCESS_LOG_PATH || "";
  const protoPath = argv["proto-log"] || PROTO_LOG_PATH;
  const usagePath = argv["usage-log"] || TOKEN_LOG_PATH;

  const [accessEntries, protoEntries, usageEntries] = await Promise.all([
    loadLog(accessPath),
    loadLog(protoPath),
    loadLog(usagePath),
  ]);

  const filtered = [];
  for (const entry of accessEntries) {
    if (entry.req_id === reqId) {
      filtered.push({ ts: normalizeTs(entry.ts), source: "access", data: entry });
    }
  }
  for (const entry of protoEntries) {
    if (entry.req_id === reqId) {
      filtered.push({ ts: normalizeTs(entry.ts), source: "proto", data: entry });
    }
  }
  for (const entry of usageEntries) {
    if (entry.req_id === reqId) {
      filtered.push({ ts: normalizeTs(entry.ts), source: "usage", data: entry });
    }
  }

  filtered.sort((a, b) => a.ts - b.ts);

  if (!filtered.length) {
    console.log(`No events found for req_id=${reqId}`);
    process.exit(0);
  }

  console.log(`Trace timeline for req_id=${reqId}`);
  for (const event of filtered) {
    console.log(formatEvent(event));
  }
}

main().catch((err) => {
  console.error("trace-by-req-id failed:", err);
  process.exit(1);
});
