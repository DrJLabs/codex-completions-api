import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..");
const TRANSCRIPT_ROOT = resolve(PROJECT_ROOT, "test-results", "chat-completions");

const PLACEHOLDER_ID = "<dynamic-id>";
const PLACEHOLDER_CREATED = "<timestamp>";

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
  return clone;
}

export function sanitizeStreamTranscript(chunks) {
  return chunks.map((entry) => {
    if (entry?.type === "done" || entry?.type === "comment") return entry;
    if (entry?.type === "data") {
      return {
        ...entry,
        data: sanitizeStreamChunk(entry.data),
      };
    }
    return entry;
  });
}

export async function loadTranscript(filename) {
  const fullPath = resolve(TRANSCRIPT_ROOT, filename);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const raw = await readFile(fullPath, "utf8");
  return JSON.parse(raw);
}

export async function saveTranscript(filename, payload) {
  const fullPath = resolve(TRANSCRIPT_ROOT, filename);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await writeFile(fullPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return fullPath;
}

export function buildMetadata({ includeUsage = false, codexBin, commit, extra = {} }) {
  return {
    captured_at: new Date().toISOString(),
    include_usage: includeUsage,
    codex_bin: codexBin,
    commit,
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
    const dataLines = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());

    if (dataLines.length > 0) {
      const payload = dataLines.join("");
      if (payload === "[DONE]") {
        entries.push({ type: "done" });
      } else {
        entries.push({ type: "data", data: JSON.parse(payload) });
      }
      continue;
    }

    const commentLines = lines
      .filter((line) => line.startsWith(":"))
      .map((line) => line.slice(1).trim())
      .filter(Boolean);
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
  "streaming-usage.json",
  "streaming-usage-length.json",
  "streaming-tool-calls.json",
  "streaming-tool-calls-sequential.json",
  "streaming-function-call.json",
  "streaming-content-filter.json",
];

export function ensureTranscripts(files = REQUIRED_TRANSCRIPTS) {
  const missingJson = files.filter((file) => {
    const fullPath = resolve(TRANSCRIPT_ROOT, file);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    return !existsSync(fullPath);
  });

  if (missingJson.length === 0) return;

  const generator = resolve(PROJECT_ROOT, "scripts", "generate-chat-transcripts.mjs");
  // Paths are repo-controlled; safe to exec for regeneration.
  execFileSync("node", [generator], { stdio: "inherit" });
}

export { TRANSCRIPT_ROOT, PLACEHOLDER_ID, PLACEHOLDER_CREATED, REQUIRED_TRANSCRIPTS };
