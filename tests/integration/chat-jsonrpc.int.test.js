import { afterEach, describe, expect, it } from "vitest";
import fetch from "node-fetch";
import { spawn } from "node:child_process";
import getPort from "get-port";
import { waitForUrlOk, stopServer, wait } from "./helpers.js";
import { joinMessages } from "../../src/utils.js";
import { config as CFG } from "../../src/config/index.js";

const CAPTURE_TIMEOUT_MS = 4000;
const MAX_ATTEMPTS = 5;

const attachCaptureCollector = (stream, out) => {
  if (!stream) return;
  stream.setEncoding("utf8");
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk;
    let idx = buffer.indexOf("\n");
    while (idx >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) {
        const jsonStart = line.indexOf("{");
        if (jsonStart >= 0) {
          const candidate = line.slice(jsonStart);
          try {
            const parsed = JSON.parse(candidate);
            if (parsed?.capture?.payload) {
              out.push(parsed.capture);
            }
          } catch {}
        }
      }
      idx = buffer.indexOf("\n");
    }
  });
};

async function startServerWithCapture(envOverrides = {}) {
  const PORT = await getPort();
  const captures = [];
  const child = spawn("node", ["server.js"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      PROXY_API_KEY: envOverrides.PROXY_API_KEY || "test-sk-ci",
      CODEX_BIN: envOverrides.CODEX_BIN || "scripts/fake-codex-jsonrpc.js",
      PROXY_USE_APP_SERVER: "true",
      PROXY_PROTECT_MODELS: envOverrides.PROXY_PROTECT_MODELS || "false",
      FAKE_CODEX_CAPTURE_RPCS: "true",
      ...(envOverrides || {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  attachCaptureCollector(child.stdout, captures);
  attachCaptureCollector(child.stderr, captures);

  await waitForUrlOk(`http://127.0.0.1:${PORT}/healthz`);
  return { PORT, child, captures };
}

const waitForCapture = async (captures, predicate, timeoutMs = CAPTURE_TIMEOUT_MS) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (captures.some(predicate)) return;
    await wait(50);
  }
  throw new Error("timeout waiting for JSON-RPC capture");
};

const findCapture = (captures, method) =>
  captures
    .slice()
    .reverse()
    .find((entry) => entry?.payload?.method === method);

const postChatCompletions = async (port, payload) => {
  let response;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-sk-ci",
      },
      body: JSON.stringify(payload),
    });
    if (response.status !== 503) break;
    await wait(200);
  }
  return response;
};

describe("chat JSON-RPC normalization", () => {
  let server;

  afterEach(async () => {
    if (server?.child) {
      await stopServer(server.child);
      server = null;
    }
  });

  it("maps chat completions request fields into JSON-RPC payloads", async () => {
    server = await startServerWithCapture({ PROXY_API_KEY: "test-sk-ci" });

    const payload = {
      model: "codex-5",
      stream: false,
      temperature: 0.2,
      top_p: 0.9,
      max_tokens: 128,
      reasoning: { effort: "medium" },
      parallel_tool_calls: true,
      stream_options: { include_usage: false },
      user: "tester",
      messages: [
        { role: "system", content: "You are Codex" },
        { role: "user", content: "List files" },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "list_files",
            description: "lists files",
            parameters: { type: "object", properties: { path: { type: "string" } } },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "list_files" } },
    };

    const response = await postChatCompletions(server.PORT, payload);

    expect(response.status).toBe(200);
    await response.json();

    await waitForCapture(server.captures, (entry) => entry?.payload?.method === "sendUserMessage");

    const turnCapture = findCapture(server.captures, "sendUserTurn");
    expect(turnCapture).toBeDefined();
    const turnMetadata = turnCapture.payload?.params?.metadata;
    expect(turnMetadata).toMatchObject({
      route: "/v1/chat/completions",
      req_id: expect.any(String),
      requested_model: "codex-5",
      effective_model: expect.any(String),
      stream: false,
      n: 1,
      user: "tester",
      reasoning_effort: "medium",
      tool_count: 1,
      parallel_tool_calls: true,
    });
    expect(turnMetadata.message_count).toBe(2);
    expect(turnMetadata.system_count).toBe(1);
    expect(turnMetadata.user_count).toBe(1);
    const turnParams = turnCapture.payload?.params;
    expect(turnParams.model).toBe(CFG.CODEX_MODEL);
    expect(turnParams.sandbox_policy).toMatchObject({ mode: CFG.PROXY_SANDBOX_MODE });
    const expectedApproval = (() => {
      const raw = process.env.PROXY_APPROVAL_POLICY ?? process.env.CODEX_APPROVAL_POLICY ?? "never";
      const normalized = String(raw).trim().toLowerCase();
      return normalized || "never";
    })();
    expect(turnParams.approval_policy).toMatchObject({ mode: expectedApproval });
    expect(turnParams.cwd).toBe(CFG.PROXY_CODEX_WORKDIR);
    expect(turnParams.reasoning).toMatchObject({ effort: "medium" });
    expect(turnParams.stream).toBe(false);
    expect(turnParams.choice_count).toBe(1);
    expect(turnParams.tools).toMatchObject({
      definitions: payload.tools,
      choice: payload.tool_choice,
      parallel_tool_calls: true,
    });

    const messageCapture = findCapture(server.captures, "sendUserMessage");
    expect(messageCapture).toBeDefined();
    const params = messageCapture.payload.params;
    expect(params.stream).toBe(false);
    expect(params.include_usage).toBe(false);
    expect(params.temperature).toBeCloseTo(0.2);
    expect(params.top_p).toBeCloseTo(0.9);
    expect(params.max_output_tokens).toBe(128);
    expect(params.tools).toMatchObject({
      definitions: payload.tools,
      choice: payload.tool_choice,
      parallel_tool_calls: true,
    });
    expect(params.metadata).toMatchObject({
      tool_count: 1,
      user: "tester",
    });
    expect(params.text).toBe(joinMessages(payload.messages));
  }, 20000);

  it("flags streaming requests and include_usage in JSON-RPC payload", async () => {
    server = await startServerWithCapture({ PROXY_API_KEY: "test-sk-ci" });

    const payload = {
      model: "codex-5",
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: "user", content: "Stream hello" }],
    };

    const response = await postChatCompletions(server.PORT, payload);

    expect(response.status).toBe(200);
    try {
      response.body?.destroy?.();
    } catch {}

    await waitForCapture(server.captures, (entry) => entry?.payload?.method === "sendUserMessage");
    const turnCapture = findCapture(server.captures, "sendUserTurn");
    expect(turnCapture?.payload?.params?.metadata?.stream).toBe(true);
    const streamingTurnParams = turnCapture?.payload?.params;
    expect(streamingTurnParams.model).toBe(CFG.CODEX_MODEL);
    expect(streamingTurnParams.sandbox_policy).toMatchObject({ mode: CFG.PROXY_SANDBOX_MODE });
    expect(streamingTurnParams.stream).toBe(true);
    const messageCapture = findCapture(server.captures, "sendUserMessage");
    expect(messageCapture.payload.params.stream).toBe(true);
    expect(messageCapture.payload.params.include_usage).toBe(true);
  }, 20000);

  it("returns invalid_request_error for non-numeric temperature", async () => {
    server = await startServerWithCapture({ PROXY_API_KEY: "test-sk-ci" });

    const payload = {
      model: "codex-5",
      messages: [{ role: "user", content: "hello" }],
      temperature: "fast",
    };

    const response = await postChatCompletions(server.PORT, payload);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error?.type).toBe("invalid_request_error");
    expect(body.error?.param).toBe("temperature");
  }, 20000);

  it("rejects invalid tool definitions", async () => {
    server = await startServerWithCapture({ PROXY_API_KEY: "test-sk-ci" });

    const payload = {
      model: "codex-5",
      messages: [{ role: "user", content: "hello" }],
      tools: [
        {
          type: "function",
          function: {
            description: "missing name",
          },
        },
      ],
    };

    const response = await postChatCompletions(server.PORT, payload);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error?.type).toBe("invalid_request_error");
    expect(body.error?.param).toBe("tools[0].function.name");
  }, 20000);
});
