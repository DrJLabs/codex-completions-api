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
const setupStreamGuardMock = vi.fn();
const applyGuardHeadersMock = vi.fn();
const createStreamObserverMock = vi.fn();
const joinMessagesMock = vi.fn();
const estTokensForMessagesMock = vi.fn();

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
  setSSEHeaders: vi.fn(),
  computeKeepaliveMs: vi.fn(() => 0),
  startKeepalives: vi.fn(() => ({ stop: vi.fn() })),
  sendSSE: vi.fn(),
  finishSSE: vi.fn(),
  sendComment: vi.fn(),
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

vi.mock("../../../../src/services/concurrency-guard.js", () => ({
  applyGuardHeaders: (...args) => applyGuardHeadersMock(...args),
  setupStreamGuard: (...args) => setupStreamGuardMock(...args),
}));

vi.mock("../../../../src/services/transport/index.js", () => ({
  mapTransportError: vi.fn(),
}));

vi.mock("../../../../src/services/transport/child-adapter.js", () => ({
  createJsonRpcChildAdapter: vi.fn(() => ({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    stdin: { write: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
  })),
}));

vi.mock("../../../../src/handlers/chat/request.js", () => ({
  normalizeChatJsonRpcRequest: vi.fn(() => ({})),
  ChatJsonRpcNormalizationError: class ChatJsonRpcNormalizationError extends Error {},
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
  maybeInjectIngressGuardrail: vi.fn(({ messages }) => ({
    injected: false,
    messages,
    markers: [],
  })),
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

const buildRes = () => ({
  locals: {},
  statusCode: null,
  headers: new Map(),
  setHeader(key, value) {
    this.headers.set(String(key), value);
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
  end: vi.fn(),
  on: vi.fn(),
});

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
  buildBackendArgsMock.mockReset().mockReturnValue([]);
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
  configMock.PROXY_MAX_PROMPT_TOKENS = 0;
  configMock.PROXY_MAX_CHAT_CHOICES = 1;
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
});
