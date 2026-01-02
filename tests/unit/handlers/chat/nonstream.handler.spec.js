import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  invalidRequestBody,
  modelNotFoundBody,
  tokensExceededBody,
} from "../../../../src/lib/errors.js";

const configMock = {
  CODEX_MODEL: "gpt-test",
  PROXY_SANDBOX_MODE: "read-only",
  PROXY_CODEX_WORKDIR: "/tmp",
  CODEX_FORCE_PROVIDER: "",
  PROXY_ENV: "prod",
  PROXY_STOP_AFTER_TOOLS: false,
  PROXY_STOP_AFTER_TOOLS_MODE: "burst",
  PROXY_STOP_AFTER_TOOLS_GRACE_MS: 0,
  PROXY_TOOL_BLOCK_MAX: 0,
  PROXY_TOOL_BLOCK_DEDUP: false,
  PROXY_TOOL_BLOCK_DELIMITER: "",
  PROXY_SUPPRESS_TAIL_AFTER_TOOLS: false,
  PROXY_TIMEOUT_MS: 1000,
  PROXY_NONSTREAM_TRUNCATE_AFTER_MS: 0,
  PROXY_KILL_ON_DISCONNECT: "true",
  PROXY_IDLE_TIMEOUT_MS: 1000,
  PROXY_ENABLE_CORS: "true",
  PROXY_CORS_ALLOWED_ORIGINS: "*",
  PROXY_MAX_CHAT_CHOICES: 1,
  PROXY_ENABLE_PARALLEL_TOOL_CALLS: false,
  PROXY_SANITIZE_METADATA: false,
  PROXY_APPROVAL_POLICY: "never",
  PROXY_MAX_PROMPT_TOKENS: 0,
  PROXY_OUTPUT_MODE: "text",
  PROXY_COPILOT_AUTO_DETECT: false,
  PROXY_INGRESS_GUARDRAIL: false,
};

const applyCorsMock = vi.fn();
const requireModelMock = vi.fn();
const acceptedModelIdsMock = vi.fn();
const validateOptionalChatParamsMock = vi.fn();
const resolveChatCopilotDetectionMock = vi.fn();
const resolveOutputModeMock = vi.fn();
const normalizeModelMock = vi.fn();
const buildBackendArgsMock = vi.fn();
const normalizeChatJsonRpcRequestMock = vi.fn();
const joinMessagesMock = vi.fn();
const estTokensForMessagesMock = vi.fn();
const installJsonLoggerMock = vi.fn();
const createToolCallAggregatorMock = vi.fn();
const createJsonRpcChildAdapterMock = vi.fn();
const mapTransportErrorMock = vi.fn();
let lastChild = null;

vi.mock("../../../../src/config/index.js", () => ({
  config: configMock,
}));

vi.mock("../../../../src/config/models.js", () => ({
  acceptedModelIds: (...args) => acceptedModelIdsMock(...args),
  MODEL_TARGET_OVERRIDES: new Map(),
  MODEL_REASONING_OVERRIDES: new Map(),
}));

vi.mock("../../../../src/services/codex-runner.js", () => ({
  resolvedCodexBin: "/usr/bin/codex",
}));

vi.mock("../../../../src/services/sse.js", () => ({
  installJsonLogger: (...args) => installJsonLoggerMock(...args),
}));

vi.mock("../../../../src/utils.js", async () => {
  const actual = await vi.importActual("../../../../src/utils.js");
  return {
    ...actual,
    applyCors: (...args) => applyCorsMock(...args),
    joinMessages: (...args) => joinMessagesMock(...args),
    estTokensForMessages: (...args) => estTokensForMessagesMock(...args),
  };
});

vi.mock("../../../../src/handlers/chat/shared.js", async () => {
  const actual = await vi.importActual("../../../../src/handlers/chat/shared.js");
  return {
    ...actual,
    validateOptionalChatParams: (...args) => validateOptionalChatParamsMock(...args),
    resolveChatCopilotDetection: (...args) => resolveChatCopilotDetectionMock(...args),
    resolveOutputMode: (...args) => resolveOutputModeMock(...args),
    normalizeModel: (...args) => normalizeModelMock(...args),
    buildBackendArgs: (...args) => buildBackendArgsMock(...args),
  };
});

vi.mock("../../../../src/dev-logging.js", () => ({
  LOG_PROTO: false,
  appendUsage: vi.fn(),
  appendProtoEvent: vi.fn(),
  extractUseToolBlocks: vi.fn(() => ({ blocks: [], nextPos: 0 })),
  logSanitizerSummary: vi.fn(),
  logSanitizerToggle: vi.fn(),
}));

vi.mock("../../../../src/services/backend-mode.js", () => ({
  selectBackendMode: vi.fn(() => "json-rpc"),
}));

vi.mock("../../../../src/services/transport/index.js", () => ({
  mapTransportError: (...args) => mapTransportErrorMock(...args),
}));

vi.mock("../../../../src/services/transport/child-adapter.js", () => ({
  createJsonRpcChildAdapter: (...args) => createJsonRpcChildAdapterMock(...args),
}));

vi.mock("../../../../src/handlers/chat/request.js", () => ({
  normalizeChatJsonRpcRequest: (...args) => normalizeChatJsonRpcRequestMock(...args),
  ChatJsonRpcNormalizationError: class ChatJsonRpcNormalizationError extends Error {
    constructor(body, statusCode = 400) {
      super("Chat request normalization failed");
      this.name = "ChatJsonRpcNormalizationError";
      this.statusCode = statusCode;
      this.body = body;
    }
  },
}));

vi.mock("../../../../src/handlers/chat/require-model.js", () => ({
  requireModel: (...args) => requireModelMock(...args),
}));

vi.mock("../../../../src/lib/ingress-guardrail.js", () => ({
  maybeInjectIngressGuardrail: vi.fn(({ messages }) => ({
    injected: false,
    messages,
    markers: [],
  })),
}));

vi.mock("../../../../src/lib/tool-call-aggregator.js", () => ({
  createToolCallAggregator: (...args) => createToolCallAggregatorMock(...args),
  toObsidianXml: vi.fn(() => ""),
}));

vi.mock("../../../../src/services/logging/schema.js", () => ({
  logStructured: vi.fn(),
}));

vi.mock("../../../../src/dev-trace/http.js", () => ({
  logHttpRequest: vi.fn(),
}));

const buildReq = (body = {}) => ({
  body,
  headers: {},
  method: "POST",
  on: vi.fn(),
});

const buildRes = () => ({
  locals: {},
  statusCode: null,
  headersSent: false,
  headers: new Map(),
  setHeader(key, value) {
    this.headers.set(String(key), value);
  },
  getHeader(key) {
    return this.headers.get(String(key));
  },
  set: vi.fn(),
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.payload = payload;
    return this;
  },
  writeHead: vi.fn(),
  end: vi.fn(),
});

const createMockChild = () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn() };
  child.kill = vi.fn();
  return child;
};

const loadHandler = async () => {
  vi.resetModules();
  const mod = await import("../../../../src/handlers/chat/nonstream.js");
  return mod.postChatNonStream;
};

beforeEach(() => {
  applyCorsMock.mockReset();
  requireModelMock.mockReset().mockReturnValue("gpt-test");
  acceptedModelIdsMock.mockReset().mockReturnValue(new Set(["gpt-test"]));
  validateOptionalChatParamsMock.mockReset().mockReturnValue({ ok: true });
  resolveChatCopilotDetectionMock.mockReset().mockReturnValue({
    copilotDetection: {
      copilot_detected: false,
      copilot_detect_tier: null,
      copilot_detect_reasons: [],
    },
  });
  resolveOutputModeMock.mockReset().mockReturnValue("text");
  normalizeModelMock.mockReset().mockReturnValue({
    requested: "gpt-test",
    effective: "gpt-test",
  });
  normalizeChatJsonRpcRequestMock.mockReset().mockReturnValue({});
  buildBackendArgsMock.mockReset().mockReturnValue([]);
  joinMessagesMock.mockReset().mockReturnValue("joined");
  estTokensForMessagesMock.mockReset().mockReturnValue(1);
  installJsonLoggerMock.mockReset();
  createToolCallAggregatorMock.mockReset().mockReturnValue({
    hasCalls: vi.fn(() => false),
    ingestMessage: vi.fn(),
    ingestDelta: vi.fn(() => ({ updated: false })),
    snapshot: vi.fn(() => []),
    supportsParallelCalls: vi.fn(() => false),
  });
  createJsonRpcChildAdapterMock.mockReset().mockImplementation(() => {
    lastChild = createMockChild();
    return lastChild;
  });
  mapTransportErrorMock.mockReset();
  configMock.PROXY_MAX_PROMPT_TOKENS = 0;
  configMock.PROXY_MAX_CHAT_CHOICES = 1;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("postChatNonStream guardrails", () => {
  it("returns early when requireModel yields empty", async () => {
    requireModelMock.mockReturnValue("");
    const postChatNonStream = await loadHandler();

    const req = buildReq({ messages: [{ role: "user", content: "hi" }] });
    const res = buildRes();

    await postChatNonStream(req, res);

    expect(requireModelMock).toHaveBeenCalled();
    expect(res.statusCode).toBeNull();
  });

  it("returns 400 when messages are missing", async () => {
    const postChatNonStream = await loadHandler();

    const req = buildReq({});
    const res = buildRes();

    await postChatNonStream(req, res);

    expect(applyCorsMock).toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.payload?.error?.param).toBe("messages");
  });

  it("returns 400 when choice count is invalid", async () => {
    const postChatNonStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
      n: "nope",
    });
    const res = buildRes();

    await postChatNonStream(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.payload?.error?.param).toBe("n");
  });

  it("returns 400 when choice count exceeds max", async () => {
    configMock.PROXY_MAX_CHAT_CHOICES = 1;
    const postChatNonStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
      n: 2,
    });
    const res = buildRes();

    await postChatNonStream(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.payload?.error?.param).toBe("n");
  });

  it("returns 400 when optional params are invalid", async () => {
    validateOptionalChatParamsMock.mockReturnValue({
      ok: false,
      error: invalidRequestBody("temperature", "invalid", "invalid_optional"),
    });
    const postChatNonStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = buildRes();

    await postChatNonStream(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.payload?.error?.code).toBe("invalid_optional");
  });

  it("returns 404 when requested model is not accepted", async () => {
    requireModelMock.mockReturnValue("gpt-bad");
    acceptedModelIdsMock.mockReturnValue(new Set(["gpt-allowed"]));
    normalizeModelMock.mockReturnValue({
      requested: "gpt-bad",
      effective: "gpt-bad",
    });
    const postChatNonStream = await loadHandler();

    const req = buildReq({
      model: "gpt-bad",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = buildRes();

    await postChatNonStream(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.payload).toEqual(modelNotFoundBody("gpt-bad"));
  });

  it("returns 403 when prompt tokens exceed limit", async () => {
    configMock.PROXY_MAX_PROMPT_TOKENS = 1;
    estTokensForMessagesMock.mockReturnValue(5);
    const postChatNonStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = buildRes();

    await postChatNonStream(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.payload).toEqual(tokensExceededBody("messages"));
  });

  it("returns normalization errors from json-rpc normalization", async () => {
    const { ChatJsonRpcNormalizationError } = await import(
      "../../../../src/handlers/chat/request.js"
    );
    const errorBody = invalidRequestBody("model", "bad model", "invalid_request_error");
    normalizeChatJsonRpcRequestMock.mockImplementation(() => {
      throw new ChatJsonRpcNormalizationError(errorBody, 422);
    });
    const postChatNonStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = buildRes();

    await postChatNonStream(req, res);

    expect(res.statusCode).toBe(422);
    expect(res.payload).toEqual(errorBody);
  });

  it("builds a response from agent_message output", async () => {
    const postChatNonStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = buildRes();

    await postChatNonStream(req, res);

    const line = JSON.stringify({
      type: "agent_message",
      message: { content: "Hello" },
    });
    lastChild.stdout.emit("data", `${line}\n`);
    lastChild.stdout.emit("end");

    expect(res.statusCode).toBe(200);
    expect(res.payload?.choices?.[0]?.message?.content).toBe("Hello");
  });

  it("builds a response from agent_message_delta output", async () => {
    const postChatNonStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = buildRes();

    await postChatNonStream(req, res);

    const line = JSON.stringify({
      type: "agent_message_delta",
      msg: { delta: { content: "Partial" } },
    });
    lastChild.stdout.emit("data", `${line}\n`);
    lastChild.stdout.emit("end");

    expect(res.statusCode).toBe(200);
    expect(res.payload?.choices?.[0]?.message?.content).toBe("Partial");
  });

  it("includes tool_calls when the aggregator reports calls", async () => {
    const toolCall = {
      id: "tool-1",
      type: "function",
      function: { name: "calc", arguments: "{}" },
    };
    createToolCallAggregatorMock.mockReturnValue({
      hasCalls: vi.fn(() => true),
      ingestMessage: vi.fn(),
      ingestDelta: vi.fn(() => ({ updated: true })),
      snapshot: vi.fn(() => [toolCall]),
      supportsParallelCalls: vi.fn(() => false),
    });
    const postChatNonStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = buildRes();

    await postChatNonStream(req, res);

    const line = JSON.stringify({
      type: "agent_message",
      message: { content: "Hello" },
    });
    lastChild.stdout.emit("data", `${line}\n`);
    lastChild.stdout.emit("end");

    expect(res.payload?.choices?.[0]?.message?.tool_calls).toHaveLength(1);
    expect(res.payload?.choices?.[0]?.finish_reason).toBe("tool_calls");
    expect(res.getHeader("x-codex-tool-call-count")).toBe("1");
  });

  it("uses token_count events to populate usage", async () => {
    const postChatNonStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = buildRes();

    await postChatNonStream(req, res);

    const tokenLine = JSON.stringify({
      type: "token_count",
      msg: { prompt_tokens: 3, completion_tokens: 2 },
    });
    lastChild.stdout.emit("data", `${tokenLine}\n`);
    lastChild.stdout.emit("end");

    expect(res.payload?.usage?.prompt_tokens).toBe(3);
    expect(res.payload?.usage?.completion_tokens).toBe(2);
    expect(res.payload?.usage?.total_tokens).toBe(5);
  });

  it("maps transport errors from child process failures", async () => {
    mapTransportErrorMock.mockReturnValue({
      statusCode: 502,
      body: {
        error: {
          message: "backend failed",
          type: "server_error",
          code: "backend_error",
        },
      },
    });
    const postChatNonStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = buildRes();

    await postChatNonStream(req, res);

    lastChild.emit("error", new Error("boom"));

    expect(res.statusCode).toBe(502);
    expect(res.payload).toEqual({
      error: {
        message: "backend failed",
        type: "server_error",
        code: "backend_error",
      },
    });
  });
});
