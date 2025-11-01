#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import fetch from "node-fetch";
import { startServer, stopServer, wait } from "../tests/integration/helpers.js";
import {
  TRANSCRIPT_ROOT,
  PROTO_TRANSCRIPT_ROOT,
  APP_TRANSCRIPT_ROOT,
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

const DEFAULT_PROTO_CODEX = "scripts/fake-codex-proto.js";
const TRUNCATION_PROTO_CODEX = "scripts/fake-codex-proto-no-complete.js";
const JSON_RPC_CODEX = "scripts/fake-codex-jsonrpc.js";

function gitCommitSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const BACKENDS = [
  {
    id: "proto",
    metadata: "proto",
    saveKey: "proto",
    codexBin: DEFAULT_PROTO_CODEX,
    env: {},
  },
  {
    id: "app",
    metadata: "app-server",
    saveKey: "app",
    codexBin: JSON_RPC_CODEX,
    env: {
      PROXY_USE_APP_SERVER: "true",
      CODEX_WORKER_SUPERVISED: "true",
    },
  },
];

const toNonStreamResponse = async (res) => ({
  response: sanitizeNonStreamResponse(await res.json()),
});

const toStreamResponse = async (res) => {
  const raw = await res.text();
  const chunks = parseSSE(raw);
  return { stream: sanitizeStreamTranscript(chunks) };
};

const SCENARIOS = [
  {
    filename: "nonstream-minimal.json",
    requestBody: {
      model: "codex-5",
      stream: false,
      messages: [{ role: "user", content: "Hello transcript" }],
    },
    processResponse: toNonStreamResponse,
  },
  {
    filename: "streaming-usage.json",
    requestBody: {
      model: "codex-5",
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: "user", content: "Stream transcript" }],
    },
    includeUsage: true,
    stream: true,
    processResponse: toStreamResponse,
  },
  {
    filename: "streaming-multi-choice.json",
    requestBody: {
      model: "codex-5",
      stream: true,
      stream_options: { include_usage: true },
      n: 2,
      messages: [{ role: "user", content: "Stream multi-choice transcript" }],
    },
    includeUsage: true,
    stream: true,
    processResponse: toStreamResponse,
  },
  {
    filename: "streaming-usage-length.json",
    requestBody: {
      model: "codex-5",
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: "user", content: "Stream transcript (length)" }],
    },
    includeUsage: true,
    stream: true,
    env: { FAKE_CODEX_FINISH_REASON: "length" },
    processResponse: toStreamResponse,
  },
  {
    filename: "nonstream-tool-calls.json",
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
    env: { FAKE_CODEX_MODE: "tool_call" },
    processResponse: toNonStreamResponse,
  },
  {
    filename: "streaming-tool-calls.json",
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
    includeUsage: true,
    stream: true,
    env: { FAKE_CODEX_MODE: "tool_call" },
    processResponse: toStreamResponse,
  },
  {
    filename: "streaming-tool-calls-sequential.json",
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
    includeUsage: true,
    stream: true,
    env: { FAKE_CODEX_MODE: "tool_call", FAKE_CODEX_PARALLEL: "false" },
    processResponse: toStreamResponse,
  },
  {
    filename: "nonstream-function-call.json",
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
    env: { FAKE_CODEX_MODE: "function_call" },
    processResponse: toNonStreamResponse,
  },
  {
    filename: "streaming-function-call.json",
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
    includeUsage: true,
    stream: true,
    env: { FAKE_CODEX_MODE: "function_call" },
    processResponse: toStreamResponse,
  },
  {
    filename: "nonstream-content-filter.json",
    requestBody: {
      model: "codex-5",
      stream: false,
      messages: [{ role: "user", content: "Generate disallowed content" }],
    },
    env: { FAKE_CODEX_MODE: "content_filter" },
    processResponse: toNonStreamResponse,
  },
  {
    filename: "streaming-content-filter.json",
    requestBody: {
      model: "codex-5",
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: "user", content: "Stream content filter scenario" }],
    },
    includeUsage: true,
    stream: true,
    env: { FAKE_CODEX_MODE: "content_filter" },
    processResponse: toStreamResponse,
  },
  {
    filename: "nonstream-truncation.json",
    requestBody: {
      model: "codex-5",
      stream: false,
      messages: [{ role: "user", content: "Trigger truncation" }],
    },
    beforeRequest: () => wait(50),
    errorLabel: "truncation",
    env: { FAKE_CODEX_FINISH_REASON: "length", FAKE_CODEX_MODE: "truncation" },
    codexOverride: { proto: TRUNCATION_PROTO_CODEX },
    processResponse: toNonStreamResponse,
  },
];

async function waitForBackendReady(backend, port, { timeoutMs = 15000, intervalMs = 200 } = {}) {
  if (backend?.id !== "app") return;
  const deadline = Date.now() + timeoutMs;
  const url = new URL(`http://127.0.0.1:${port}/healthz`);

  // Local helper to determine readiness from health payload
  const hasReadyFlag = (payload) => {
    if (!payload) return false;
    if (payload.readiness?.ready === true) return true;
    if (payload.worker_supervisor?.ready === true) return true;
    if (payload.worker_supervisor?.readiness?.ready === true) return true;
    if (payload.worker_status?.ready === true) return true;
    if (payload.worker_status?.readiness?.ready === true) return true;
    if (payload.worker_status?.health?.readiness?.ready === true) return true;
    return false;
  };

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const body = await res.json();
        if (body?.app_server_enabled === true && hasReadyFlag(body)) return;
      }
    } catch {
      // Ignore transient failures while waiting for readiness
    }
    await wait(intervalMs);
  }

  throw new Error(`app backend worker did not become ready within ${timeoutMs}ms`);
}

async function runCapture({
  backend,
  codexBin,
  filename,
  includeUsage,
  commitSha,
  createPayload,
  serverEnv,
  metadata: metadataPayload,
}) {
  const ctx = await startServer({
    CODEX_BIN: codexBin,
    ...(backend?.env ?? {}),
    ...(serverEnv || {}),
  });
  try {
    await waitForBackendReady(backend, ctx.PORT);
    const transcriptPayload = await createPayload(ctx.PORT);
    const scenarioId = metadataPayload?.scenario ?? filename.replace(/\.json$/, "");
    const extra = {
      scenario: scenarioId,
      backend: backend?.metadata ?? backend?.id ?? "proto",
      backend_storage: backend?.saveKey ?? "proto",
    };
    if (metadataPayload?.extra) Object.assign(extra, metadataPayload.extra);
    const transcript = {
      metadata: buildMetadata({
        includeUsage,
        codexBin,
        commit: commitSha,
        extra,
      }),
      ...transcriptPayload,
    };
    await saveTranscript(filename, transcript, { backend: backend?.saveKey });
  } finally {
    await stopServer(ctx.child);
  }
}

async function captureChatScenario({ backend, scenario, commitSha }) {
  const {
    filename,
    includeUsage = false,
    requestBody,
    stream = false,
    beforeRequest,
    processResponse,
    errorLabel,
    env,
    codexOverride,
    metadata,
  } = scenario;

  const codexBin = codexOverride?.[backend.id] ?? backend.codexBin;
  return runCapture({
    backend,
    codexBin,
    filename,
    includeUsage,
    commitSha,
    serverEnv: env,
    metadata: {
      scenario: filename.replace(/\.json$/, ""),
      extra: metadata,
    },
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
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await mkdir(PROTO_TRANSCRIPT_ROOT, { recursive: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await mkdir(APP_TRANSCRIPT_ROOT, { recursive: true });

  const commitSha = gitCommitSha();

  for (const backend of BACKENDS) {
    for (const scenario of SCENARIOS) {
      await captureChatScenario({ backend, scenario, commitSha });
    }
    const targetRoot = backend.saveKey === "app" ? APP_TRANSCRIPT_ROOT : PROTO_TRANSCRIPT_ROOT;
    console.log(`Captured ${backend.metadata} transcripts in`, targetRoot);
  }

  console.log("Transcripts refreshed in", TRANSCRIPT_ROOT);
}

main().catch((err) => {
  console.error("Failed to generate transcripts:", err);
  process.exit(1);
});
