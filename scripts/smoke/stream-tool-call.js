#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..", "..");
const ARTIFACT_DIR = resolve(
  PROJECT_ROOT,
  "docs",
  "bmad",
  "qa",
  "artifacts",
  "streaming-tool-call"
);

const args = new Set(process.argv.slice(2));
const includeUsage = args.has("--include-usage") || args.has("--includeUsage") || args.has("-u");
const baseUrl = process.env.BASE_URL || "http://127.0.0.1:11435";
const trimmedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
const endpoint = `${trimmedBase}/v1/chat/completions?stream=true`;
const apiKey = process.env.KEY || process.env.PROXY_API_KEY;

if (!apiKey) {
  console.error("Missing KEY or PROXY_API_KEY environment variable.");
  process.exit(1);
}

const requestBody = {
  model: process.env.MODEL || "codex-5",
  stream: true,
  messages: [{ role: "user", content: "Stream tool execution" }],
  tools: [
    {
      type: "function",
      function: {
        name: "lookup_user",
        description: "Returns fake profile information",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string" },
          },
          required: ["id"],
        },
      },
    },
  ],
  tool_choice: { type: "function", function: { name: "lookup_user" } },
};

if (includeUsage) {
  requestBody.stream_options = { include_usage: true };
}

const controller = new AbortController();
const timeoutMs = Number(process.env.TIMEOUT_MS || 30_000);
const timeout = setTimeout(() => controller.abort(), timeoutMs);

let rawSSE = "";
const decoder = new TextDecoder();

try {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
    signal: controller.signal,
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`Request failed (${res.status}): ${errText}`);
    process.exit(1);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    console.error("Streaming response body missing reader interface.");
    process.exit(1);
  }

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) rawSSE += decoder.decode(value, { stream: true });
  }
  rawSSE += decoder.decode();
} catch (error) {
  if (error?.name === "AbortError") {
    console.error(`Request timed out after ${timeoutMs}ms.`);
  } else {
    console.error("Smoke request failed:", error);
  }
  process.exit(1);
} finally {
  clearTimeout(timeout);
}

await mkdir(ARTIFACT_DIR, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const baseName = `streaming-tool-call-${timestamp}`;
const logPath = resolve(ARTIFACT_DIR, `${baseName}.sse`);
// eslint-disable-next-line security/detect-non-literal-fs-filename -- path is constructed from project-root constants and sanitized timestamp
await writeFile(logPath, rawSSE, "utf8");

const hash = createHash("sha256").update(rawSSE, "utf8").digest("hex");
const hashPath = resolve(ARTIFACT_DIR, `${baseName}.sha256`);
// eslint-disable-next-line security/detect-non-literal-fs-filename -- path is constructed from project-root constants and sanitized timestamp
await writeFile(hashPath, `${hash}  ${baseName}.sse\n`, "utf8");

console.log(
  JSON.stringify({
    status: "ok",
    endpoint,
    includeUsage,
    logPath,
    hashPath,
    sha256: hash,
  })
);
