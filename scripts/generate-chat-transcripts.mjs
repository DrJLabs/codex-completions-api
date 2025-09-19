#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import fetch from "node-fetch";
import { startServer, stopServer, wait } from "../tests/integration/helpers.js";
import {
  TRANSCRIPT_ROOT,
  saveTranscript,
  sanitizeNonStreamResponse,
  sanitizeStreamTranscript,
  parseSSE,
  buildMetadata,
} from "../tests/shared/transcript-utils.js";

const BASE_HEADERS = {
  "Content-Type": "application/json",
  Authorization: "Bearer test-sk-ci",
};

function gitCommitSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

async function runCapture({ codexBin, filename, includeUsage, commitSha, createPayload }) {
  const ctx = await startServer({ CODEX_BIN: codexBin });
  try {
    const transcriptPayload = await createPayload(ctx.PORT);
    const transcript = {
      metadata: buildMetadata({
        includeUsage,
        codexBin,
        commit: commitSha,
        extra: { scenario: filename.replace(/\.json$/, "") },
      }),
      ...transcriptPayload,
    };
    await saveTranscript(filename, transcript);
  } finally {
    await stopServer(ctx.child);
  }
}

async function captureNonStream({ requestBody, filename, codexBin, commitSha }) {
  return runCapture({
    codexBin,
    filename,
    includeUsage: false,
    commitSha,
    createPayload: async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: "POST",
        headers: BASE_HEADERS,
        body: JSON.stringify(requestBody),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`non-stream request failed (${res.status}): ${text}`);
      }
      const payload = await res.json();
      return {
        request: requestBody,
        response: sanitizeNonStreamResponse(payload),
      };
    },
  });
}

async function captureNonStreamLength({ requestBody, filename, codexBin, commitSha }) {
  return runCapture({
    codexBin,
    filename,
    includeUsage: false,
    commitSha,
    createPayload: async (port) => {
      await wait(50);
      const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: "POST",
        headers: BASE_HEADERS,
        body: JSON.stringify(requestBody),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`truncation request failed (${res.status}): ${text}`);
      }
      const payload = await res.json();
      return {
        request: requestBody,
        response: sanitizeNonStreamResponse(payload),
      };
    },
  });
}

async function captureStreaming({ requestBody, filename, codexBin, commitSha }) {
  return runCapture({
    codexBin,
    filename,
    includeUsage: true,
    commitSha,
    createPayload: async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions?stream=true`, {
        method: "POST",
        headers: BASE_HEADERS,
        body: JSON.stringify(requestBody),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`streaming request failed (${res.status}): ${text}`);
      }
      const raw = await res.text();
      const chunks = parseSSE(raw);
      return {
        request: requestBody,
        stream: sanitizeStreamTranscript(chunks),
      };
    },
  });
}

async function main() {
  // Transcript directory is within the repo; path is controlled.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await mkdir(TRANSCRIPT_ROOT, { recursive: true });

  const defaultCodex = "scripts/fake-codex-proto.js";
  const truncationCodex = "scripts/fake-codex-proto-no-complete.js";
  const commitSha = gitCommitSha();

  await captureNonStream({
    requestBody: {
      model: "codex-5",
      stream: false,
      messages: [{ role: "user", content: "Hello transcript" }],
    },
    filename: "nonstream-minimal.json",
    codexBin: defaultCodex,
    commitSha,
  });

  await captureStreaming({
    requestBody: {
      model: "codex-5",
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: "user", content: "Stream transcript" }],
    },
    filename: "streaming-usage.json",
    codexBin: defaultCodex,
    commitSha,
  });

  await captureNonStreamLength({
    requestBody: {
      model: "codex-5",
      stream: false,
      messages: [{ role: "user", content: "Trigger truncation" }],
    },
    filename: "nonstream-truncation.json",
    codexBin: truncationCodex,
    commitSha,
  });

  console.log("Transcripts refreshed in", TRANSCRIPT_ROOT);
}

main().catch((err) => {
  console.error("Failed to generate transcripts:", err);
  process.exit(1);
});
