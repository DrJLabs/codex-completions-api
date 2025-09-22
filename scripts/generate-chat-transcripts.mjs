#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import fetch from "node-fetch";
import YAML from "yaml";
import { startServer, stopServer, wait } from "../tests/integration/helpers.js";
import {
  TRANSCRIPT_ROOT,
  saveTranscript,
  sanitizeNonStreamResponse,
  sanitizeStreamTranscript,
  parseSSE,
  buildMetadata,
  PLACEHOLDER_ID,
  PLACEHOLDER_CREATED,
} from "../tests/shared/transcript-utils.js";
import { isKeployEnabled } from "../tests/shared/keploy-runner.js";

const BASE_HEADERS = {
  "Content-Type": "application/json",
  Authorization: "Bearer test-sk-ci",
};

const KEPLOY_ROOT = resolve(TRANSCRIPT_ROOT, "keploy", "test-set-0", "tests");

async function maybeWriteKeploySnapshot(filename, transcript) {
  if (!isKeployEnabled()) return;
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await mkdir(KEPLOY_ROOT, { recursive: true });
  const scenario = transcript?.metadata?.scenario || filename.replace(/\.json$/, "");
  const yamlPayload = buildKeployYaml({ scenario, transcript });
  const target = resolve(KEPLOY_ROOT, `${scenario}.yaml`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await writeFile(target, `${yamlPayload}\n`, "utf8");
}

function buildKeployYaml({ scenario, transcript }) {
  const { metadata, request, response, stream } = transcript;
  const description = `Chat completions snapshot for ${scenario}`;
  const capturedAt = metadata?.captured_at ?? new Date().toISOString();
  const createdEpochSeconds = Math.floor(new Date(capturedAt).getTime() / 1000);
  const port = process.env.KEPLOY_APP_PORT || "11436";
  const baseUrl = `http://127.0.0.1:${port}`;
  const isStream = Array.isArray(stream);
  const bodyPayload = response ?? { stream };
  const requestJson = JSON.stringify(request, null, 2);
  const responseJson = JSON.stringify(bodyPayload, null, 2);
  const requestUrl = new URL(`/v1/chat/completions`, baseUrl);
  if (request?.stream) {
    requestUrl.searchParams.set("stream", "true");
  }

  const noisePaths = isStream
    ? ["$.stream[*].data.id", "$.stream[*].data.created"]
    : ["$.id", "$.created"];

  const doc = new YAML.Document({
    version: "api.keploy.io/v1beta1",
    kind: "Http",
    name: scenario,
    spec: {
      metadata: {
        description,
        codex_bin: String(metadata.codex_bin ?? ""),
        commit: String(metadata.commit ?? ""),
        include_usage: String(Boolean(metadata.include_usage)),
        placeholders: JSON.stringify({
          id: PLACEHOLDER_ID,
          created: PLACEHOLDER_CREATED,
        }),
      },
      req: {
        method: "POST",
        proto_major: 1,
        proto_minor: 1,
        url: requestUrl.toString(),
        header: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-sk-ci",
        },
        body: requestJson,
        timestamp: capturedAt,
      },
      resp: {
        status_code: 200,
        header: {
          "Content-Type": isStream ? "text/event-stream" : "application/json; charset=utf-8",
        },
        body: responseJson,
        proto_major: 1,
        proto_minor: 1,
        timestamp: capturedAt,
      },
      objects: [],
      assertions: {
        noise: {
          body: noisePaths,
        },
      },
      created: createdEpochSeconds,
    },
  });

  const requestNode = doc.getIn(["spec", "req", "body"]);
  if (YAML.isScalar(requestNode)) {
    requestNode.type = YAML.Scalar.BLOCK_LITERAL;
  }

  const responseNode = doc.getIn(["spec", "resp", "body"]);
  if (YAML.isScalar(responseNode)) {
    responseNode.type = YAML.Scalar.BLOCK_LITERAL;
  }

  return doc.toString().trimEnd();
}

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
    await maybeWriteKeploySnapshot(filename, transcript);
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
