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
  PROXY_STOP_AFTER_TOOLS_MODE: "",
  PROXY_STOP_AFTER_TOOLS_GRACE_MS: 0,
  PROXY_TOOL_BLOCK_MAX: 0,
  PROXY_SUPPRESS_TAIL_AFTER_TOOLS: false,
  PROXY_TIMEOUT_MS: 1000,
  PROXY_KILL_ON_DISCONNECT: "true",
  PROXY_STREAM_IDLE_TIMEOUT_MS: 1000,
  PROXY_ENABLE_CORS: "true",
  PROXY_CORS_ALLOWED_ORIGINS: "*",
  PROXY_TEST_ENDPOINTS: false,
  PROXY_MAX_CHAT_CHOICES: 1,
  PROXY_ENABLE_PARALLEL_TOOL_CALLS: false,
  PROXY_SANITIZE_METADATA: false,
  PROXY_APPROVAL_POLICY: "never",
  PROXY_MAX_PROMPT_TOKENS: 0,
  PROXY_OUTPUT_MODE: "text",
  PROXY_COPILOT_AUTO_DETECT: false,
  PROXY_INGRESS_GUARDRAIL: false,
  PROXY_SSE_MAX_CONCURRENCY: 0,
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
const setupStreamGuardMock = vi.fn();
const applyGuardHeadersMock = vi.fn();
const createStreamObserverMock = vi.fn();
const joinMessagesMock = vi.fn();
const estTokensForMessagesMock = vi.fn();
const logSanitizerSummaryMock = vi.fn();
const logSanitizerToggleMock = vi.fn();
const appendProtoEventMock = vi.fn();
const setSSEHeadersMock = vi.fn();
const computeKeepaliveMsMock = vi.fn(() => 0);
const startKeepalivesMock = vi.fn(() => ({ stop: vi.fn() }));
const sendSSEMock = vi.fn();
const finishSSEMock = vi.fn();
const sendCommentMock = vi.fn();
const createToolCallAggregatorMock = vi.fn();
const maybeInjectIngressGuardrailMock = vi.fn();
const createJsonRpcChildAdapterMock = vi.fn();
const mapTransportErrorMock = vi.fn();
let lastChild = null;

const createMockChild = () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn() };
  child.kill = vi.fn();
  return child;
};

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
  setSSEHeaders: (...args) => setSSEHeadersMock(...args),
  computeKeepaliveMs: (...args) => computeKeepaliveMsMock(...args),
  startKeepalives: (...args) => startKeepalivesMock(...args),
  sendSSE: (...args) => sendSSEMock(...args),
  finishSSE: (...args) => finishSSEMock(...args),
  sendComment: (...args) => sendCommentMock(...args),
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
  appendProtoEvent: (...args) => appendProtoEventMock(...args),
  extractUseToolBlocks: vi.fn(() => ({ blocks: [], nextPos: 0 })),
  logSanitizerSummary: (...args) => logSanitizerSummaryMock(...args),
  logSanitizerToggle: (...args) => logSanitizerToggleMock(...args),
}));

vi.mock("../../../../src/services/concurrency-guard.js", () => ({
  applyGuardHeaders: (...args) => applyGuardHeadersMock(...args),
  setupStreamGuard: (...args) => setupStreamGuardMock(...args),
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

vi.mock("../../../../src/handlers/chat/stop-after-tools-controller.js", () => ({
  createStopAfterToolsController: vi.fn(() => ({
    schedule: vi.fn(),
    cancel: vi.fn(),
  })),
}));

vi.mock("../../../../src/services/backend-mode.js", () => ({
  selectBackendMode: vi.fn(() => "json-rpc"),
}));

vi.mock("../../../../src/services/metrics/index.js", () => ({
  createStreamObserver: (...args) => createStreamObserverMock(...args),
}));

vi.mock("../../../../src/services/tracing.js", () => ({
  startSpan: vi.fn(() => ({ setAttribute: vi.fn() })),
  endSpan: vi.fn(),
}));

vi.mock("../../../../src/services/metrics/chat.js", () => ({
  toolBufferMetrics: {
    start: vi.fn(),
    flush: vi.fn(),
    abort: vi.fn(),
  },
}));

vi.mock("../../../../src/lib/ingress-guardrail.js", () => ({
  maybeInjectIngressGuardrail: (...args) => maybeInjectIngressGuardrailMock(...args),
}));

vi.mock("../../../../src/handlers/chat/tool-buffer.js", () => ({
  createToolBufferTracker: vi.fn(() => ({ active: false })),
  trackToolBufferOpen: vi.fn(() => -1),
  detectNestedToolBuffer: vi.fn(() => -1),
  clampEmittableIndex: vi.fn((_state, _forwarded, end) => end),
  completeToolBuffer: vi.fn(),
  abortToolBuffer: vi.fn(() => ({ literal: "" })),
  shouldSkipBlock: vi.fn(() => false),
}));

vi.mock("../../../../src/handlers/chat/capture.js", () => ({
  createChatStreamCapture: vi.fn(() => ({
    record: vi.fn(),
    recordDone: vi.fn(),
    finalize: vi.fn(),
  })),
}));

vi.mock("../../../../src/lib/tool-call-aggregator.js", () => ({
  createToolCallAggregator: (...args) => createToolCallAggregatorMock(...args),
  toObsidianXml: vi.fn(() => ""),
}));

vi.mock("../../../../src/lib/observability/transform-summary.js", () => ({
  summarizeTextParts: vi.fn(() => ({
    output_text_bytes: 0,
    output_text_hash: "",
    xml_in_text: false,
  })),
  summarizeToolCalls: vi.fn(() => ({
    tool_call_count: 0,
    tool_names: [],
    tool_names_truncated: false,
  })),
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

const buildRes = () => {
  const res = new EventEmitter();
  res.locals = {};
  res.statusCode = null;
  res.headers = new Map();
  res.setHeader = function setHeader(key, value) {
    this.headers.set(String(key), value);
  };
  res.set = vi.fn();
  res.status = function status(code) {
    this.statusCode = code;
    return this;
  };
  res.json = function json(payload) {
    this.payload = payload;
    return this;
  };
  res.end = vi.fn();
  return res;
};

const loadHandler = async () => {
  vi.resetModules();
  const mod = await import("../../../../src/handlers/chat/stream.js");
  return mod.postChatStream;
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
  createJsonRpcChildAdapterMock.mockReset().mockImplementation(() => {
    lastChild = createMockChild();
    return lastChild;
  });
  mapTransportErrorMock.mockReset();
  setupStreamGuardMock.mockReset().mockReturnValue({
    acquired: true,
    token: "guard",
    release: vi.fn(),
  });
  applyGuardHeadersMock.mockReset();
  createStreamObserverMock.mockReset().mockReturnValue({
    markFirst: vi.fn(),
    end: vi.fn(),
  });
  joinMessagesMock.mockReset().mockReturnValue("joined");
  estTokensForMessagesMock.mockReset().mockReturnValue(1);
  logSanitizerSummaryMock.mockReset();
  logSanitizerToggleMock.mockReset();
  setSSEHeadersMock.mockReset();
  computeKeepaliveMsMock.mockReset().mockReturnValue(0);
  startKeepalivesMock.mockReset().mockReturnValue({ stop: vi.fn() });
  sendCommentMock.mockReset();
  appendProtoEventMock.mockReset();
  createToolCallAggregatorMock.mockReset().mockReturnValue({
    hasCalls: vi.fn(() => false),
    ingestMessage: vi.fn(),
    ingestDelta: vi.fn(() => ({ updated: false })),
    snapshot: vi.fn(() => []),
    supportsParallelCalls: vi.fn(() => false),
  });
  maybeInjectIngressGuardrailMock.mockReset().mockImplementation(({ messages }) => ({
    injected: false,
    messages,
    markers: [],
  }));
  configMock.PROXY_MAX_PROMPT_TOKENS = 0;
  configMock.PROXY_MAX_CHAT_CHOICES = 1;
  configMock.PROXY_SANITIZE_METADATA = false;
  configMock.PROXY_SUPPRESS_TAIL_AFTER_TOOLS = false;
  configMock.PROXY_ENV = "prod";
  lastChild = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("postChatStream", () => {
  it("returns early when requireModel yields empty", async () => {
    requireModelMock.mockReturnValue("");
    const postChatStream = await loadHandler();

    const req = buildReq({ messages: [{ role: "user", content: "hi" }] });
    const res = buildRes();

    await postChatStream(req, res);

    expect(requireModelMock).toHaveBeenCalled();
    expect(setupStreamGuardMock).not.toHaveBeenCalled();
    expect(res.statusCode).toBeNull();
  });

  it("returns 400 when messages missing", async () => {
    const postChatStream = await loadHandler();

    const req = buildReq({});
    const res = buildRes();

    await postChatStream(req, res);

    expect(applyCorsMock).toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.payload?.error?.code).toBe("invalid_request_error");
  });

  it("returns 400 when choice count is invalid", async () => {
    const postChatStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
      n: "nope",
    });
    const res = buildRes();

    await postChatStream(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.payload?.error?.param).toBe("n");
  });

  it("returns 400 when choice count exceeds max", async () => {
    const postChatStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
      n: 2,
    });
    const res = buildRes();

    await postChatStream(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.payload?.error?.param).toBe("n");
  });

  it("returns 400 when optional params invalid", async () => {
    validateOptionalChatParamsMock.mockReturnValue({
      ok: false,
      error: invalidRequestBody("temperature", "invalid", "invalid_optional"),
    });
    const postChatStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = buildRes();

    await postChatStream(req, res);

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
    const postChatStream = await loadHandler();

    const req = buildReq({
      model: "gpt-bad",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = buildRes();

    await postChatStream(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.payload).toEqual(modelNotFoundBody("gpt-bad"));
  });

  it("uses guardrail-injected messages for copilot detection", async () => {
    const injectedMessages = [{ role: "system", content: "guard" }];
    maybeInjectIngressGuardrailMock.mockReturnValue({
      injected: true,
      messages: injectedMessages,
      markers: ["guardrail"],
    });
    const postChatStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = buildRes();

    await postChatStream(req, res);

    expect(resolveChatCopilotDetectionMock).toHaveBeenCalledWith(
      expect.objectContaining({ messages: injectedMessages, markers: ["guardrail"] })
    );
  });

  it("returns 403 when prompt tokens exceed limit", async () => {
    configMock.PROXY_MAX_PROMPT_TOKENS = 1;
    estTokensForMessagesMock.mockReturnValue(5);
    const postChatStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = buildRes();

    await postChatStream(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.payload).toEqual(tokensExceededBody("messages"));
  });

  it("sends role chunks for each requested choice", async () => {
    configMock.PROXY_MAX_CHAT_CHOICES = 2;
    const postChatStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
      n: 2,
    });
    const res = buildRes();

    await postChatStream(req, res);

    const firstPayload = sendSSEMock.mock.calls[0][1];
    expect(firstPayload?.choices).toHaveLength(2);
    expect(firstPayload.choices.every((choice) => choice.delta?.role === "assistant")).toBe(true);
  });

  it("exits when stream guard does not acquire", async () => {
    setupStreamGuardMock.mockReturnValue({
      acquired: false,
      token: "guard",
      release: vi.fn(),
    });
    const postChatStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = buildRes();

    await postChatStream(req, res);

    expect(setupStreamGuardMock).toHaveBeenCalled();
    expect(applyGuardHeadersMock).not.toHaveBeenCalled();
  });

  it("returns 429 when stream guard triggers concurrency error", async () => {
    setupStreamGuardMock.mockImplementation(({ send429 }) => {
      send429();
      return { acquired: false };
    });
    const postChatStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = buildRes();

    await postChatStream(req, res);

    expect(res.statusCode).toBe(429);
    expect(res.payload?.error?.code).toBe("concurrency_exceeded");
    expect(applyCorsMock).toHaveBeenCalled();
  });

  it("logs dev prompt traces when PROXY_ENV is dev", async () => {
    configMock.PROXY_ENV = "dev";
    const postChatStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = buildRes();

    await postChatStream(req, res);

    expect(appendProtoEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "submission" })
    );
  });

  it("returns normalization errors from json-rpc normalization", async () => {
    const { ChatJsonRpcNormalizationError } = await import(
      "../../../../src/handlers/chat/request.js"
    );
    const releaseMock = vi.fn();
    const errorBody = invalidRequestBody("model", "bad model", "invalid_request_error");
    normalizeChatJsonRpcRequestMock.mockImplementation(() => {
      throw new ChatJsonRpcNormalizationError(errorBody, 422);
    });
    setupStreamGuardMock.mockReturnValue({
      acquired: true,
      token: "guard",
      release: releaseMock,
    });
    const postChatStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = buildRes();

    await postChatStream(req, res);

    expect(res.statusCode).toBe(422);
    expect(res.payload).toEqual(errorBody);
    expect(applyGuardHeadersMock).toHaveBeenCalledWith(res, "guard", false);
    expect(releaseMock).toHaveBeenCalledWith("normalization_error");
  });

  it("sets output mode headers before normalization errors", async () => {
    const { ChatJsonRpcNormalizationError } = await import(
      "../../../../src/handlers/chat/request.js"
    );
    resolveOutputModeMock.mockReturnValue("obsidian-xml");
    normalizeChatJsonRpcRequestMock.mockImplementation(() => {
      throw new ChatJsonRpcNormalizationError({ error: { code: "bad" } }, 422);
    });
    const postChatStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = buildRes();

    await postChatStream(req, res);

    expect(res.headers.get("x-proxy-output-mode")).toBe("obsidian-xml");
    expect(res.locals.output_mode_effective).toBe("obsidian-xml");
  });

  it("sends keepalive comments when keepalive is enabled", async () => {
    computeKeepaliveMsMock.mockReturnValue(5);
    startKeepalivesMock.mockImplementation((_res, _ms, cb) => {
      cb();
      return { stop: vi.fn() };
    });
    const postChatStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = buildRes();

    await postChatStream(req, res);

    const keepaliveCall = sendCommentMock.mock.calls.find(([, payload]) =>
      String(payload).includes("keepalive")
    );
    expect(keepaliveCall).toBeTruthy();
  });

  it("respects stream adapter onChunk override", async () => {
    const postChatStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = buildRes();
    const onChunk = vi.fn(() => true);
    res.locals.streamAdapter = { onChunk };

    await postChatStream(req, res);

    expect(onChunk).toHaveBeenCalled();
    expect(sendSSEMock).not.toHaveBeenCalled();
  });

  it("respects stream adapter onDone override", async () => {
    const postChatStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = buildRes();
    const onDone = vi.fn(() => true);
    res.locals.streamAdapter = { onDone };

    await postChatStream(req, res);

    lastChild.emit("close");

    expect(onDone).toHaveBeenCalled();
    expect(finishSSEMock).not.toHaveBeenCalled();
  });

  it("streams agent_message_delta content as SSE chunks", async () => {
    const postChatStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = buildRes();

    await postChatStream(req, res);

    lastChild.stdout.emit(
      "data",
      Buffer.from(JSON.stringify({ type: "agent_message_delta", msg: { delta: "hello" } }) + "\n")
    );
    lastChild.emit("close");

    const sawContent = sendSSEMock.mock.calls.some(([, payload]) =>
      payload?.choices?.some((choice) => choice?.delta?.content === "hello")
    );

    expect(sawContent).toBe(true);
  });

  it("flattens array content deltas", async () => {
    const postChatStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = buildRes();

    await postChatStream(req, res);

    lastChild.stdout.emit(
      "data",
      Buffer.from(
        JSON.stringify({
          type: "agent_message_delta",
          msg: { delta: { content: ["hi", { text: " there" }] } },
        }) + "\n"
      )
    );
    lastChild.emit("close");

    const sawFlattened = sendSSEMock.mock.calls.some(([, payload]) =>
      payload?.choices?.some((choice) => choice?.delta?.content === "hi there")
    );

    expect(sawFlattened).toBe(true);
  });

  it("emits text deltas from agent_message_delta", async () => {
    const postChatStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = buildRes();

    await postChatStream(req, res);

    lastChild.stdout.emit(
      "data",
      Buffer.from(
        JSON.stringify({ type: "agent_message_delta", msg: { delta: { text: "hello" } } }) + "\n"
      )
    );
    lastChild.emit("close");

    const sawText = sendSSEMock.mock.calls.some(([, payload]) =>
      payload?.choices?.some((choice) => choice?.delta?.content === "hello")
    );

    expect(sawText).toBe(true);
  });

  it("emits tool call deltas from the aggregator", async () => {
    const toolDelta = {
      id: "tool-1",
      type: "function",
      function: { name: "calc", arguments: "{}" },
    };
    createToolCallAggregatorMock.mockReturnValue({
      hasCalls: vi.fn(() => true),
      ingestMessage: vi.fn(),
      ingestDelta: vi.fn(() => ({ updated: true, deltas: [toolDelta] })),
      snapshot: vi.fn(() => [toolDelta]),
      supportsParallelCalls: vi.fn(() => false),
    });
    resolveOutputModeMock.mockReturnValue("obsidian-xml");
    const postChatStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = buildRes();

    await postChatStream(req, res);

    lastChild.stdout.emit(
      "data",
      Buffer.from(
        JSON.stringify({
          type: "agent_message_delta",
          msg: { delta: { tool_calls: [toolDelta], content: "" } },
        }) + "\n"
      )
    );
    lastChild.emit("close");

    const sawToolDelta = sendSSEMock.mock.calls.some(([, payload]) =>
      payload?.choices?.some((choice) => choice?.delta?.tool_calls?.[0]?.function?.name === "calc")
    );

    expect(sawToolDelta).toBe(true);
  });

  it("short-circuits child errors when tool evidence exists", async () => {
    createToolCallAggregatorMock.mockReturnValue({
      hasCalls: vi.fn(() => true),
      ingestMessage: vi.fn(),
      ingestDelta: vi.fn(() => ({ updated: false })),
      snapshot: vi.fn(() => []),
      supportsParallelCalls: vi.fn(() => false),
    });
    const postChatStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = buildRes();

    await postChatStream(req, res);

    lastChild.emit("error", new Error("boom"));

    expect(mapTransportErrorMock).not.toHaveBeenCalled();
  });

  it("trims content after tool blocks when suppressing tail", async () => {
    configMock.PROXY_SUPPRESS_TAIL_AFTER_TOOLS = true;
    const postChatStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = buildRes();

    await postChatStream(req, res);

    lastChild.stdout.emit(
      "data",
      Buffer.from(
        JSON.stringify({
          type: "agent_message_delta",
          msg: { delta: { content: "before <use_tool>call</use_tool> after" } },
        }) + "\n"
      )
    );
    lastChild.emit("close");

    const payloadWithTool = sendSSEMock.mock.calls.find(([, payload]) =>
      payload?.choices?.some((choice) => choice?.delta?.content?.includes("</use_tool>"))
    )?.[1];

    expect(payloadWithTool?.choices?.[0]?.delta?.content).toBe("before <use_tool>call</use_tool>");
  });

  it("flushes fallback content on child close when no choices sent", async () => {
    const postChatStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = buildRes();

    await postChatStream(req, res);

    lastChild.stdout.emit("data", Buffer.from("Hello world\n"));
    lastChild.emit("close");

    const sawContent = sendSSEMock.mock.calls.some(([, payload]) =>
      payload?.choices?.some((choice) => choice?.delta?.content === "Hello world")
    );

    expect(sawContent).toBe(true);
  });

  it("maps child errors through transport mapping and finishes SSE", async () => {
    mapTransportErrorMock.mockReturnValue({
      statusCode: 502,
      body: { error: { code: "backend_error", message: "boom" } },
    });
    const postChatStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = buildRes();

    await postChatStream(req, res);

    lastChild.emit("error", new Error("boom"));
    lastChild.emit("close");

    const sawError = sendSSEMock.mock.calls.some(
      ([, payload]) => payload?.error?.code === "backend_error"
    );

    expect(sawError).toBe(true);
    expect(finishSSEMock).toHaveBeenCalled();
  });

  it("emits usage chunks when include_usage is requested", async () => {
    const postChatStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
      stream_options: { include_usage: true },
    });
    const res = buildRes();

    await postChatStream(req, res);

    lastChild.stdout.emit(
      "data",
      Buffer.from(JSON.stringify({ type: "agent_message_delta", msg: { delta: "hello" } }) + "\n")
    );
    lastChild.emit("close");

    const sawUsage = sendSSEMock.mock.calls.some(
      ([, payload]) => payload?.usage && typeof payload.usage.prompt_tokens === "number"
    );

    expect(sawUsage).toBe(true);
  });

  it("drops function_call_output payloads flagged by guardrails", async () => {
    const postChatStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = buildRes();

    await postChatStream(req, res);

    const initialCalls = sendSSEMock.mock.calls.length;
    lastChild.stdout.emit(
      "data",
      Buffer.from(
        JSON.stringify({
          type: "function_call_output",
          msg: { output: "resources/list failed: missing context" },
        }) + "\n"
      )
    );
    const afterEventCalls = sendSSEMock.mock.calls.length;

    lastChild.emit("close");

    expect(afterEventCalls).toBe(initialCalls);
  });

  it("logs sanitizer summary when metadata sanitizer is enabled", async () => {
    configMock.PROXY_SANITIZE_METADATA = true;
    const postChatStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = buildRes();

    await postChatStream(req, res);

    lastChild.emit("close");

    expect(logSanitizerSummaryMock).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true })
    );
  });
});
