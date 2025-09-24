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

async function runCapture({
  codexBin,
  filename,
  includeUsage,
  commitSha,
  createPayload,
  protoEnv,
}) {
  const ctx = await startServer({ CODEX_BIN: codexBin, ...(protoEnv || {}) });
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

async function captureChatScenario({
  codexBin,
  filename,
  commitSha,
  includeUsage = false,
  requestBody,
  stream = false,
  beforeRequest,
  processResponse,
  errorLabel,
  protoEnv,
}) {
  return runCapture({
    codexBin,
    filename,
    includeUsage,
    commitSha,
    protoEnv,
    createPayload: async (port) => {
      if (beforeRequest) await beforeRequest();
      const url = new URL(`http://127.0.0.1:${port}/v1/chat/completions`);
      if (stream) url.searchParams.set("stream", "true");
      const res = await fetch(url, {
        method: "POST",
        headers: BASE_HEADERS,
        body: JSON.stringify(requestBody),
      });
      if (!res.ok) {
        const text = await res.text();
        const label = errorLabel ?? (stream ? "streaming" : "non-stream");
        throw new Error(`${label} request failed (${res.status}): ${text}`);
      }
      const payload = await processResponse(res);
      return {
        request: requestBody,
        ...payload,
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

  await captureChatScenario({
    requestBody: {
      model: "codex-5",
      stream: false,
      messages: [{ role: "user", content: "Hello transcript" }],
    },
    filename: "nonstream-minimal.json",
    codexBin: defaultCodex,
    commitSha,
    processResponse: async (res) => ({
      response: sanitizeNonStreamResponse(await res.json()),
    }),
  });

  await captureChatScenario({
    requestBody: {
      model: "codex-5",
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: "user", content: "Stream transcript" }],
    },
    filename: "streaming-usage.json",
    codexBin: defaultCodex,
    commitSha,
    includeUsage: true,
    stream: true,
    processResponse: async (res) => {
      const raw = await res.text();
      const chunks = parseSSE(raw);
      return { stream: sanitizeStreamTranscript(chunks) };
    },
  });

  await captureChatScenario({
    requestBody: {
      model: "codex-5",
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: "user", content: "Stream transcript (length)" }],
    },
    filename: "streaming-usage-length.json",
    codexBin: defaultCodex,
    commitSha,
    includeUsage: true,
    stream: true,
    protoEnv: { FAKE_CODEX_FINISH_REASON: "length" },
    processResponse: async (res) => {
      const raw = await res.text();
      const chunks = parseSSE(raw);
      return { stream: sanitizeStreamTranscript(chunks) };
    },
  });

  await captureChatScenario({
    requestBody: {
      model: "codex-5",
      stream: false,
      messages: [{ role: "user", content: "Run the lookup tool for user 42" }],
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
    },
    filename: "nonstream-tool-calls.json",
    codexBin: defaultCodex,
    commitSha,
    protoEnv: { FAKE_CODEX_MODE: "tool_call" },
    processResponse: async (res) => ({
      response: sanitizeNonStreamResponse(await res.json()),
    }),
  });

  await captureChatScenario({
    requestBody: {
      model: "codex-5",
      stream: true,
      stream_options: { include_usage: true },
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
    },
    filename: "streaming-tool-calls.json",
    codexBin: defaultCodex,
    commitSha,
    includeUsage: true,
    stream: true,
    protoEnv: { FAKE_CODEX_MODE: "tool_call" },
    processResponse: async (res) => {
      const raw = await res.text();
      const chunks = parseSSE(raw);
      return { stream: sanitizeStreamTranscript(chunks) };
    },
  });

  await captureChatScenario({
    requestBody: {
      model: "codex-5",
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: "user", content: "Stream tool execution (sequential)" }],
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
    },
    filename: "streaming-tool-calls-sequential.json",
    codexBin: defaultCodex,
    commitSha,
    includeUsage: true,
    stream: true,
    protoEnv: { FAKE_CODEX_MODE: "tool_call", FAKE_CODEX_PARALLEL: "false" },
    processResponse: async (res) => {
      const raw = await res.text();
      const chunks = parseSSE(raw);
      return { stream: sanitizeStreamTranscript(chunks) };
    },
  });

  await captureChatScenario({
    requestBody: {
      model: "codex-5",
      stream: false,
      messages: [{ role: "user", content: "Call legacy function" }],
      tools: [
        {
          type: "function",
          function: {
            name: "legacy_lookup",
            description: "Returns fake info",
            parameters: {
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"],
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "legacy_lookup" } },
    },
    filename: "nonstream-function-call.json",
    codexBin: defaultCodex,
    commitSha,
    protoEnv: { FAKE_CODEX_MODE: "function_call" },
    processResponse: async (res) => ({
      response: sanitizeNonStreamResponse(await res.json()),
    }),
  });

  await captureChatScenario({
    requestBody: {
      model: "codex-5",
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: "user", content: "Stream legacy function" }],
      tools: [
        {
          type: "function",
          function: {
            name: "legacy_lookup",
            description: "Returns fake info",
            parameters: {
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"],
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "legacy_lookup" } },
    },
    filename: "streaming-function-call.json",
    codexBin: defaultCodex,
    commitSha,
    includeUsage: true,
    stream: true,
    protoEnv: { FAKE_CODEX_MODE: "function_call" },
    processResponse: async (res) => {
      const raw = await res.text();
      const chunks = parseSSE(raw);
      return { stream: sanitizeStreamTranscript(chunks) };
    },
  });

  await captureChatScenario({
    requestBody: {
      model: "codex-5",
      stream: false,
      messages: [{ role: "user", content: "Generate disallowed content" }],
    },
    filename: "nonstream-content-filter.json",
    codexBin: defaultCodex,
    commitSha,
    protoEnv: { FAKE_CODEX_MODE: "content_filter" },
    processResponse: async (res) => ({
      response: sanitizeNonStreamResponse(await res.json()),
    }),
  });

  await captureChatScenario({
    requestBody: {
      model: "codex-5",
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: "user", content: "Stream content filter scenario" }],
    },
    filename: "streaming-content-filter.json",
    codexBin: defaultCodex,
    commitSha,
    includeUsage: true,
    stream: true,
    protoEnv: { FAKE_CODEX_MODE: "content_filter" },
    processResponse: async (res) => {
      const raw = await res.text();
      const chunks = parseSSE(raw);
      return { stream: sanitizeStreamTranscript(chunks) };
    },
  });

  await captureChatScenario({
    requestBody: {
      model: "codex-5",
      stream: false,
      messages: [{ role: "user", content: "Trigger truncation" }],
    },
    filename: "nonstream-truncation.json",
    codexBin: truncationCodex,
    commitSha,
    beforeRequest: () => wait(50),
    errorLabel: "truncation",
    processResponse: async (res) => ({
      response: sanitizeNonStreamResponse(await res.json()),
    }),
  });

  console.log("Transcripts refreshed in", TRANSCRIPT_ROOT);
}

main().catch((err) => {
  console.error("Failed to generate transcripts:", err);
  process.exit(1);
});
