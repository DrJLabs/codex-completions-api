import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const codexPkg = require("@openai/codex/package.json");

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..");
const TRANSCRIPT_ROOT = resolve(PROJECT_ROOT, "test-results", "chat-completions");
const PROTO_TRANSCRIPT_ROOT = resolve(TRANSCRIPT_ROOT, "proto");
const APP_TRANSCRIPT_ROOT = resolve(TRANSCRIPT_ROOT, "app");
const TRANSCRIPT_MANIFEST_PATH = resolve(TRANSCRIPT_ROOT, "manifest.json");
const RESPONSES_TRANSCRIPT_ROOT = resolve(PROJECT_ROOT, "test-results", "responses");

const PLACEHOLDER_ID = "<dynamic-id>";
const PLACEHOLDER_CREATED = "<timestamp>";
const RESP_PLACEHOLDER_ID = "<dynamic-response-id>";
const RESP_PLACEHOLDER_MSG_ID = "<dynamic-response-message-id>";
const RESP_PLACEHOLDER_TOOL_ID = "<dynamic-response-tool-id>";
const RESP_PLACEHOLDER_PREVIOUS_ID = "<dynamic-previous-response-id>";

const CODEX_CLI_VERSION = codexPkg?.version ?? "unknown";

export function sanitizeNonStreamResponse(payload) {
  if (typeof payload !== "object" || payload === null) return payload;
  const clone = structuredClone(payload);
  clone.id = PLACEHOLDER_ID;
  clone.created = PLACEHOLDER_CREATED;
  return clone;
}

export function sanitizeStreamChunk(chunk) {
  if (typeof chunk !== "object" || chunk === null) return chunk;
  const clone = structuredClone(chunk);
  clone.id = PLACEHOLDER_ID;
  clone.created = PLACEHOLDER_CREATED;
  if (clone.usage && typeof clone.usage === "object") {
    delete clone.usage.time_to_first_token_ms;
    delete clone.usage.total_duration_ms;
  }
  return clone;
}

export function sanitizeStreamTranscript(chunks) {
  return chunks.map((entry) => {
    if (entry?.type === "done" || entry?.type === "comment") {
      if (entry?.event) {
        return { ...entry };
      }
      return entry;
    }
    if (entry?.type === "data") {
      return {
        ...entry,
        data: sanitizeStreamChunk(entry.data),
        ...(entry.event ? { event: entry.event } : {}),
      };
    }
    return entry;
  });
}

const APP_BACKEND_KEYS = new Set(["app", "app-server"]);

function normalizeBackendName(backend) {
  if (APP_BACKEND_KEYS.has(String(backend).toLowerCase())) return "app";
  return "proto";
}

function resolveTranscriptPath(filename, backend) {
  const normalized = normalizeBackendName(backend);
  const baseRoot = normalized === "app" ? APP_TRANSCRIPT_ROOT : PROTO_TRANSCRIPT_ROOT;
  const desiredPath = resolve(baseRoot, filename);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (normalized === "proto" && !existsSync(desiredPath)) {
    const legacyPath = resolve(TRANSCRIPT_ROOT, filename);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (existsSync(legacyPath)) return legacyPath;
  }
  return desiredPath;
}

function resolveTranscriptSavePath(filename, backend) {
  const normalized = normalizeBackendName(backend);
  const baseRoot = normalized === "app" ? APP_TRANSCRIPT_ROOT : PROTO_TRANSCRIPT_ROOT;
  return resolve(baseRoot, filename);
}

export async function loadTranscript(filename, { backend = "proto" } = {}) {
  const fullPath = resolveTranscriptPath(filename, backend);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const raw = await readFile(fullPath, "utf8");
  return JSON.parse(raw);
}

export async function saveTranscript(filename, payload, { backend = "proto" } = {}) {
  const fullPath = resolveTranscriptSavePath(filename, backend);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await mkdir(dirname(fullPath), { recursive: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await writeFile(fullPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return fullPath;
}

export async function saveTranscriptManifest(manifest) {
  await mkdir(dirname(TRANSCRIPT_MANIFEST_PATH), { recursive: true });
  await writeFile(TRANSCRIPT_MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return TRANSCRIPT_MANIFEST_PATH;
}

export async function loadTranscriptManifest() {
  const raw = await readFile(TRANSCRIPT_MANIFEST_PATH, "utf8");
  return JSON.parse(raw);
}

export function buildMetadata({ includeUsage = false, codexBin, commit, extra = {} }) {
  return {
    captured_at: new Date().toISOString(),
    include_usage: includeUsage,
    codex_bin: codexBin,
    commit,
    cli_version: CODEX_CLI_VERSION,
    node_version: process.version,
    ...extra,
  };
}

export function parseSSE(raw) {
  const entries = [];
  const blocks = raw
    .split(/\r?\n\r?\n/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const dataLines = [];
    let eventName = null;
    const commentLines = [];
    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
        continue;
      }
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim());
        continue;
      }
      if (line.startsWith(":")) {
        const comment = line.slice(1).trim();
        if (comment) commentLines.push(comment);
      }
    }
    if (dataLines.length > 0) {
      const payload = dataLines.join("");
      if (payload === "[DONE]" || payload === '"[DONE]"') {
        const doneEntry = { type: "done" };
        if (eventName) doneEntry.event = eventName;
        entries.push(doneEntry);
      } else {
        const entry = { type: "data", data: JSON.parse(payload) };
        if (eventName) entry.event = eventName;
        entries.push(entry);
      }
      continue;
    }

    if (commentLines.length > 0) {
      entries.push({ type: "comment", comment: commentLines.join("\n") });
    }
  }
  return entries;
}

const REQUIRED_TRANSCRIPTS = [
  "nonstream-minimal.json",
  "nonstream-truncation.json",
  "nonstream-tool-calls.json",
  "nonstream-content-filter.json",
  "nonstream-function-call.json",
  "nonstream-invalid-request.json",
  "streaming-usage.json",
  "streaming-usage-length.json",
  "streaming-tool-calls.json",
  "streaming-tool-calls-sequential.json",
  "streaming-function-call.json",
  "streaming-content-filter.json",
  "streaming-multi-choice.json",
];

export function ensureTranscripts(files = REQUIRED_TRANSCRIPTS, { backend = "proto" } = {}) {
  const backends = Array.isArray(backend) ? backend : [backend];
  const missing = [];
  for (const name of backends) {
    const normalized = normalizeBackendName(name);
    const root = normalized === "app" ? APP_TRANSCRIPT_ROOT : PROTO_TRANSCRIPT_ROOT;
    for (const file of files) {
      const desired = resolve(root, file);

      // eslint-disable-next-line security/detect-non-literal-fs-filename
      if (!existsSync(desired)) {
        if (normalized === "proto") {
          const legacy = resolve(TRANSCRIPT_ROOT, file);
          // eslint-disable-next-line security/detect-non-literal-fs-filename
          if (existsSync(legacy)) continue;
        }
        missing.push({ backend: normalized, file });
      }
    }
  }

  if (missing.length === 0) return;

  const generator = resolve(PROJECT_ROOT, "scripts", "generate-chat-transcripts.mjs");
  // Paths are repo-controlled; safe to exec for regeneration.
  execFileSync("node", [generator], { stdio: "inherit" });
}

export {
  TRANSCRIPT_ROOT,
  PROTO_TRANSCRIPT_ROOT,
  APP_TRANSCRIPT_ROOT,
  TRANSCRIPT_MANIFEST_PATH,
  PLACEHOLDER_ID,
  PLACEHOLDER_CREATED,
  REQUIRED_TRANSCRIPTS,
};

export function sanitizeResponsesNonStream(payload) {
  if (typeof payload !== "object" || payload === null) return payload;
  const clone = structuredClone(payload);
  clone.id = RESP_PLACEHOLDER_ID;
  if (Array.isArray(clone.output)) {
    clone.output = clone.output.map((item) => {
      if (!item || typeof item !== "object") return item;
      const next = structuredClone(item);
      next.id = RESP_PLACEHOLDER_MSG_ID;
      if (Array.isArray(next.content)) {
        next.content = next.content.map((contentItem) => {
          if (!contentItem || typeof contentItem !== "object") return contentItem;
          const contentClone = structuredClone(contentItem);
          if (contentClone.type === "tool_use" && contentClone.id) {
            contentClone.id = RESP_PLACEHOLDER_TOOL_ID;
          }
          return contentClone;
        });
      }
      return next;
    });
  }
  if (clone.previous_response_id) {
    clone.previous_response_id = RESP_PLACEHOLDER_PREVIOUS_ID;
  }
  return clone;
}

export function sanitizeResponsesStreamTranscript(entries) {
  return entries.map((entry) => {
    if (!entry) return entry;
    if (entry.type === "done" || entry.type === "comment") {
      return entry.event ? { ...entry } : entry;
    }
    if (entry.type === "data") {
      const clone = {
        type: "data",
        data: structuredClone(entry.data),
      };
      if (entry.event) clone.event = entry.event;
      if (clone.event === "response.created" && clone.data?.response) {
        clone.data.response = {
          ...clone.data.response,
          id: RESP_PLACEHOLDER_ID,
        };
      }
      if (clone.event === "response.completed" && clone.data?.response) {
        clone.data.response = sanitizeResponsesNonStream(clone.data.response);
      }
      return clone;
    }
    return entry;
  });
}

export async function loadResponsesTranscript(filename) {
  const fullPath = resolve(RESPONSES_TRANSCRIPT_ROOT, filename);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- transcripts live under repo-controlled directory
  const raw = await readFile(fullPath, "utf8");
  return JSON.parse(raw);
}

export async function saveResponsesTranscript(filename, payload) {
  const fullPath = resolve(RESPONSES_TRANSCRIPT_ROOT, filename);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- transcripts live under repo-controlled directory
  await writeFile(fullPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return fullPath;
}

const REQUIRED_RESPONSES_TRANSCRIPTS = [
  "nonstream-minimal.json",
  "nonstream-tool-call.json",
  "nonstream-previous-response.json",
  "streaming-text.json",
  "streaming-tool-call.json",
];

export function ensureResponsesTranscripts(files = REQUIRED_RESPONSES_TRANSCRIPTS) {
  const missing = files.filter((file) => {
    const fullPath = resolve(RESPONSES_TRANSCRIPT_ROOT, file);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- transcripts live under repo-controlled directory
    return !existsSync(fullPath);
  });
  if (missing.length === 0) return;

  const generator = resolve(PROJECT_ROOT, "scripts", "generate-responses-transcripts.mjs");
  execFileSync("node", [generator], { stdio: "inherit" });
}

export {
  RESPONSES_TRANSCRIPT_ROOT,
  RESP_PLACEHOLDER_ID,
  RESP_PLACEHOLDER_MSG_ID,
  RESP_PLACEHOLDER_TOOL_ID,
  RESP_PLACEHOLDER_PREVIOUS_ID,
  REQUIRED_RESPONSES_TRANSCRIPTS,
};
