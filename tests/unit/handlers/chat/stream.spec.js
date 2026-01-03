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
const appendUsageMock = vi.fn();
const extractUseToolBlocksMock = vi.fn(() => ({ blocks: [], nextPos: 0 }));
const setSSEHeadersMock = vi.fn();
const computeKeepaliveMsMock = vi.fn(() => 0);
const startKeepalivesMock = vi.fn(() => ({ stop: vi.fn() }));
const sendSSEMock = vi.fn();
const finishSSEMock = vi.fn();
const sendCommentMock = vi.fn();
const createToolCallAggregatorMock = vi.fn();
const toObsidianXmlMock = vi.fn(() => "");
const maybeInjectIngressGuardrailMock = vi.fn();
const createJsonRpcChildAdapterMock = vi.fn();
const mapTransportErrorMock = vi.fn();
const createStopAfterToolsControllerMock = vi.fn();
const createToolBufferTrackerMock = vi.fn();
const trackToolBufferOpenMock = vi.fn(() => -1);
const detectNestedToolBufferMock = vi.fn(() => -1);
const clampEmittableIndexMock = vi.fn((_state, _forwarded, end) => end);
const completeToolBufferMock = vi.fn();
const abortToolBufferMock = vi.fn(() => ({ literal: "" }));
const shouldSkipBlockMock = vi.fn(() => false);
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
  appendUsage: (...args) => appendUsageMock(...args),
  appendProtoEvent: (...args) => appendProtoEventMock(...args),
  extractUseToolBlocks: (...args) => extractUseToolBlocksMock(...args),
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
  createStopAfterToolsController: (...args) => createStopAfterToolsControllerMock(...args),
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
  createToolBufferTracker: (...args) => createToolBufferTrackerMock(...args),
  trackToolBufferOpen: (...args) => trackToolBufferOpenMock(...args),
  detectNestedToolBuffer: (...args) => detectNestedToolBufferMock(...args),
  clampEmittableIndex: (...args) => clampEmittableIndexMock(...args),
  completeToolBuffer: (...args) => completeToolBufferMock(...args),
  abortToolBuffer: (...args) => abortToolBufferMock(...args),
  shouldSkipBlock: (...args) => shouldSkipBlockMock(...args),
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
  toObsidianXml: (...args) => toObsidianXmlMock(...args),
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
  extractUseToolBlocksMock.mockReset().mockReturnValue({ blocks: [], nextPos: 0 });
  setSSEHeadersMock.mockReset();
  computeKeepaliveMsMock.mockReset().mockReturnValue(0);
  startKeepalivesMock.mockReset().mockReturnValue({ stop: vi.fn() });
  sendCommentMock.mockReset();
  appendProtoEventMock.mockReset();
  appendUsageMock.mockReset();
  createStopAfterToolsControllerMock.mockReset().mockReturnValue({
    schedule: vi.fn(),
    cancel: vi.fn(),
  });
  createToolCallAggregatorMock.mockReset().mockReturnValue({
    hasCalls: vi.fn(() => false),
    ingestMessage: vi.fn(),
    ingestDelta: vi.fn(() => ({ updated: false })),
    snapshot: vi.fn(() => []),
    supportsParallelCalls: vi.fn(() => false),
  });
  createToolBufferTrackerMock.mockReset().mockReturnValue({ active: false });
  trackToolBufferOpenMock.mockReset().mockReturnValue(-1);
  detectNestedToolBufferMock.mockReset().mockReturnValue(-1);
  clampEmittableIndexMock.mockReset().mockImplementation((_state, _forwarded, end) => end);
  completeToolBufferMock.mockReset();
  abortToolBufferMock.mockReset().mockReturnValue({ literal: "" });
  shouldSkipBlockMock.mockReset().mockReturnValue(false);
  toObsidianXmlMock.mockReset().mockReturnValue("");
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

  it("returns 400 when choice count is below minimum", async () => {
    const postChatStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
      n: "0",
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

  it("accepts string choice count values", async () => {
    configMock.PROXY_MAX_CHAT_CHOICES = 2;
    const postChatStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
      n: "2",
    });
    const res = buildRes();

    await postChatStream(req, res);

    const firstPayload = sendSSEMock.mock.calls[0][1];
    expect(firstPayload?.choices).toHaveLength(2);
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

  it("logs textual tool metadata errors in dev", async () => {
    configMock.PROXY_ENV = "dev";
    createToolCallAggregatorMock.mockReturnValue({
      hasCalls: vi.fn(() => false),
      ingestMessage: vi.fn(() => {
        throw new Error("boom");
      }),
      ingestDelta: vi.fn(() => ({ updated: false })),
      snapshot: vi.fn(() => []),
      supportsParallelCalls: vi.fn(() => false),
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const postChatStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = buildRes();

    await postChatStream(req, res);

    lastChild.stdout.emit(
      "data",
      Buffer.from(JSON.stringify({ type: "agent_message", msg: { message: "tool: hi" } }) + "\n")
    );
    lastChild.emit("close");

    expect(errorSpy).toHaveBeenCalledWith(
      "[dev][stream] textual tool metadata error",
      expect.any(Error)
    );
    errorSpy.mockRestore();
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

  it("rethrows unexpected normalization errors after applying cors", async () => {
    const releaseMock = vi.fn();
    normalizeChatJsonRpcRequestMock.mockImplementation(() => {
      throw new Error("boom");
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

    await expect(postChatStream(req, res)).rejects.toThrow("boom");

    expect(applyCorsMock).toHaveBeenCalled();
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

  it("skips stream capture for responses endpoint mode", async () => {
    const postChatStream = await loadHandler();
    const { createChatStreamCapture } = await import("../../../../src/handlers/chat/capture.js");

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = buildRes();
    res.locals.endpoint_mode = "responses";

    await postChatStream(req, res);

    expect(createChatStreamCapture).not.toHaveBeenCalled();
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

  it("clears numeric keepalive intervals on close", async () => {
    computeKeepaliveMsMock.mockReturnValue(5);
    startKeepalivesMock.mockReturnValue(123);
    const clearSpy = vi.spyOn(global, "clearInterval");
    const postChatStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = buildRes();

    await postChatStream(req, res);

    res.emit("close");

    expect(clearSpy).toHaveBeenCalledWith(123);
    clearSpy.mockRestore();
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
      payload?.choices?.some((choice) => choice?.delta?.content?.includes("hello"))
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

  it("uses SSE error body when transport mapping is missing", async () => {
    mapTransportErrorMock.mockReturnValue(null);
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
      ([, payload]) => payload?.error?.code === "spawn_error" && payload?.error?.message === "boom"
    );

    expect(sawError).toBe(true);
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

  it("uses token_count events for usage payloads", async () => {
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
      Buffer.from(
        JSON.stringify({
          type: "token_count",
          msg: { prompt_tokens: 3, completion_tokens: 5 },
        }) + "\n"
      )
    );
    lastChild.emit("close");

    const usagePayload = sendSSEMock.mock.calls.find(([, payload]) => payload?.usage)?.[1];

    expect(usagePayload?.usage?.prompt_tokens).toBe(3);
    expect(usagePayload?.usage?.completion_tokens).toBe(5);
    expect(usagePayload?.usage?.total_tokens).toBe(8);
  });

  it("uses provider usage events when available", async () => {
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
      Buffer.from(
        JSON.stringify({
          type: "usage",
          msg: { usage: { prompt_tokens: 7, completion_tokens: 9 } },
        }) + "\n"
      )
    );
    lastChild.emit("close");

    const usagePayload = sendSSEMock.mock.calls.find(([, payload]) => payload?.usage)?.[1];

    expect(usagePayload?.usage?.prompt_tokens).toBe(7);
    expect(usagePayload?.usage?.completion_tokens).toBe(9);
    expect(usagePayload?.usage?.total_tokens).toBe(16);
  });

  it("emits finish chunks on task_complete events", async () => {
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
          type: "task_complete",
          msg: { finish_reason: "stop", prompt_tokens: 2, completion_tokens: 4 },
        }) + "\n"
      )
    );

    const finishPayload = sendSSEMock.mock.calls.find(([, payload]) =>
      payload?.choices?.some((choice) => choice.finish_reason === "stop")
    );

    expect(finishPayload).toBeTruthy();
  });

  it("defaults task_complete to length when no finish reason or content", async () => {
    const postChatStream = await loadHandler();

    const req = buildReq({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
    });
    const res = buildRes();

    await postChatStream(req, res);

    lastChild.stdout.emit(
      "data",
      Buffer.from(JSON.stringify({ type: "task_complete", msg: {} }) + "\n")
    );

    const finishPayload = sendSSEMock.mock.calls.find(([, payload]) =>
      payload?.choices?.some((choice) => choice.finish_reason === "length")
    );

    expect(finishPayload).toBeTruthy();
  });

  it("emits obsidian tool content from aggregator snapshots", async () => {
    const toolDelta = {
      id: "tool-1",
      type: "function",
      function: { name: "calc", arguments: "{}" },
    };
    createToolCallAggregatorMock.mockReturnValue({
      hasCalls: vi.fn(() => true),
      ingestMessage: vi.fn(),
      ingestDelta: vi.fn(() => ({ updated: true, deltas: [toolDelta] })),
      snapshot: vi.fn(() => [
        { id: "tool-1", type: "function", function: { name: "calc", arguments: '{"x":1}' } },
      ]),
      supportsParallelCalls: vi.fn(() => false),
    });
    toObsidianXmlMock.mockReturnValue("<use_tool>calc</use_tool>");
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

    const sawXml = sendSSEMock.mock.calls.some(([, payload]) =>
      payload?.choices?.some((choice) => choice?.delta?.content?.includes("<use_tool>"))
    );

    expect(sawXml).toBe(true);
  });

  it("records metadata sanitizer events when enabled", async () => {
    configMock.PROXY_SANITIZE_METADATA = true;
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
          msg: {
            delta: { content: "session_id: abc\n", metadata: { session_id: "abc" } },
          },
        }) + "\n"
      )
    );
    lastChild.emit("close");

    const sanitizerEvent = appendProtoEventMock.mock.calls.find(
      ([payload]) => payload?.kind === "metadata_sanitizer"
    );

    expect(sanitizerEvent).toBeTruthy();
    expect(logSanitizerToggleMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
  });

  it("records metadata sanitizer events from metadata stream events", async () => {
    configMock.PROXY_SANITIZE_METADATA = true;
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
          type: "metadata",
          msg: { metadata: { session_id: "abc" }, sources: ["payload.metadata"] },
        }) + "\n"
      )
    );
    lastChild.emit("close");

    const sanitizerEvent = appendProtoEventMock.mock.calls.find(
      ([payload]) =>
        payload?.kind === "metadata_sanitizer" && payload?.metadata?.session_id === "abc"
    );

    expect(sanitizerEvent).toBeTruthy();
  });

  it("holds partial metadata lines until completion", async () => {
    configMock.PROXY_SANITIZE_METADATA = true;
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
          type: "agent_message_delta",
          msg: { delta: { content: "session_" } },
        }) + "\n"
      )
    );

    expect(sendSSEMock.mock.calls.length).toBe(initialCalls);

    lastChild.stdout.emit(
      "data",
      Buffer.from(
        JSON.stringify({
          type: "agent_message_delta",
          msg: { delta: { content: "id: abc\nhello\n" } },
        }) + "\n"
      )
    );
    lastChild.emit("close");

    const sanitizerEvent = appendProtoEventMock.mock.calls.find(
      ([payload]) => payload?.kind === "metadata_sanitizer" && payload?.removed_lines?.length === 1
    );

    expect(sanitizerEvent).toBeTruthy();
  });

  it("deduplicates repeated metadata removals in summary counts", async () => {
    configMock.PROXY_SANITIZE_METADATA = true;
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
          msg: { delta: { content: "session_id: abc\nsession_id: abc\n" } },
        }) + "\n"
      )
    );
    lastChild.emit("close");

    expect(logSanitizerSummaryMock).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, count: 1 })
    );
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

  it("skips aggregator XML emission when textual tool prefixes are present", async () => {
    const toolDelta = {
      id: "tool-1",
      type: "function",
      function: { name: "calc", arguments: '{"x":1}' },
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
          msg: { delta: { content: "<use_t", tool_calls: [toolDelta] } },
        }) + "\n"
      )
    );

    expect(toObsidianXmlMock).not.toHaveBeenCalled();
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

  it("logs usage failures when appendUsage throws in dev", async () => {
    configMock.PROXY_ENV = "dev";
    appendUsageMock.mockImplementation(() => {
      throw new Error("boom");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const postChatStream = await loadHandler();

    const req = buildReq({ messages: [] });
    const res = buildRes();

    await postChatStream(req, res);

    expect(errorSpy).toHaveBeenCalledWith(
      "[dev][usage][stream] failed to append usage",
      expect.any(Error)
    );
    errorSpy.mockRestore();
  });

  it("falls back to SSE when stream adapter onChunk throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const postChatStream = await loadHandler();

    const req = buildReq({ messages: [{ role: "user", content: "hi" }] });
    const res = buildRes();
    res.locals.streamAdapter = {
      onChunk: vi.fn(() => {
        throw new Error("boom");
      }),
    };

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
    expect(errorSpy).toHaveBeenCalledWith(
      "[proxy][chat.stream] stream adapter onChunk failed",
      expect.any(Error)
    );
    errorSpy.mockRestore();
  });

  it("schedules stop-after-tools when delta repeats emitted content", async () => {
    const scheduleMock = vi.fn();
    createStopAfterToolsControllerMock.mockReturnValue({
      schedule: scheduleMock,
      cancel: vi.fn(),
    });
    const postChatStream = await loadHandler();

    const req = buildReq({ messages: [{ role: "user", content: "hi" }] });
    const res = buildRes();

    await postChatStream(req, res);

    lastChild.stdout.emit(
      "data",
      Buffer.from(
        JSON.stringify({ type: "agent_message_delta", msg: { delta: "hello world" } }) + "\n"
      )
    );
    lastChild.stdout.emit(
      "data",
      Buffer.from(JSON.stringify({ type: "agent_message_delta", msg: { delta: "world" } }) + "\n")
    );

    expect(scheduleMock).toHaveBeenCalledWith(0);
  });

  it("flushes nested tool buffer content", async () => {
    resolveOutputModeMock.mockReturnValue("obsidian-xml");
    trackToolBufferOpenMock.mockReturnValue(0);
    detectNestedToolBufferMock.mockReturnValue(1);
    abortToolBufferMock.mockReturnValue({ literal: "<use_tool>call</use_tool>" });
    createToolBufferTrackerMock.mockReturnValue({
      active: { start: 0, nestedScanPos: 0 },
      skipUntil: 0,
    });
    const postChatStream = await loadHandler();

    const req = buildReq({ messages: [{ role: "user", content: "hi" }] });
    const res = buildRes();

    await postChatStream(req, res);

    lastChild.stdout.emit(
      "data",
      Buffer.from(
        JSON.stringify({ type: "agent_message_delta", msg: { delta: "<use_tool>call" } }) + "\n"
      )
    );

    const sawTool = sendSSEMock.mock.calls.some(([, payload]) =>
      payload?.choices?.some((choice) => choice?.delta?.content === "<use_tool>call</use_tool>")
    );

    expect(sawTool).toBe(true);
    expect(abortToolBufferMock).toHaveBeenCalled();
  });

  it("emits tool stats comments when tool calls forward in text mode", async () => {
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
    resolveOutputModeMock.mockReturnValue("text");
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

    const toolStatPayload = sendCommentMock.mock.calls
      .map(([, payload]) => {
        try {
          return JSON.parse(String(payload));
        } catch {
          return null;
        }
      })
      .find((payload) => payload?.tool_call_count);

    expect(toolStatPayload?.tool_call_count).toBe(1);
  });
});
