import { resolvedCodexBin } from "../../services/codex-runner.js";
import {
  setSSEHeaders,
  computeKeepaliveMs,
  startKeepalives,
  sendSSE as sendSSEUtil,
  finishSSE as finishSSEUtil,
  sendComment as sendCommentUtil,
} from "../../services/sse.js";
import { nanoid } from "nanoid";
import {
  stripAnsi,
  estTokensForMessages,
  joinMessages,
  impliedEffortForModel,
  normalizeModel,
  applyCors as applyCorsUtil,
} from "../../utils.js";
import { config as CFG } from "../../config/index.js";
import { acceptedModelIds } from "../../config/models.js";
import { resolveChoiceIndexFromPayload } from "./choice-index.js";
import {
  modelNotFoundBody,
  invalidRequestBody,
  tokensExceededBody,
  sseErrorBody,
} from "../../lib/errors.js";
import {
  LOG_PROTO,
  appendUsage,
  appendProtoEvent,
  extractUseToolBlocks,
  logSanitizerSummary,
  logSanitizerToggle,
} from "../../dev-logging.js";
import {
  buildBackendArgs,
  createFinishReasonTracker,
  extractFinishReasonFromMessage,
  logFinishReasonTelemetry,
  coerceAssistantContent,
  validateOptionalChatParams,
  resolveChatCopilotDetection,
  resolveOutputMode,
} from "./shared.js";
import { createToolCallAggregator } from "../../lib/tool-call-aggregator.js";
import { applyGuardHeaders, setupStreamGuard } from "../../services/concurrency-guard.js";
import {
  extractMetadataFromPayload,
  sanitizeMetadataTextSegment,
  metadataKeys,
  normalizeMetadataKey,
} from "../../lib/metadata-sanitizer.js";
import { selectBackendMode } from "../../services/backend-mode.js";
import { mapTransportError } from "../../services/transport/index.js";
import { createJsonRpcChildAdapter } from "../../services/transport/child-adapter.js";
import { normalizeChatJsonRpcRequest, ChatJsonRpcNormalizationError } from "./request.js";
import { requireModel } from "./require-model.js";
import { createStopAfterToolsController } from "./stop-after-tools-controller.js";
import { parseStreamEventLine } from "./stream-event.js";
import { createStreamEventRouter } from "./stream-event-router.js";
import { createStreamMetadataSanitizer } from "./stream-metadata-sanitizer.js";
import { createStreamOutputCoordinator } from "./stream-output.js";
import { createStreamRuntime } from "./stream-runtime.js";
import { createStreamTimers } from "./stream-timers.js";
import { createStreamRuntimeEmitter } from "./stream-runtime-emitter.js";
import { wireStreamTransport } from "./stream-transport.js";
import { createStreamUsageTracker } from "./stream-usage-tracker.js";
import { createToolCallNormalizer } from "./tool-call-normalizer.js";
import { buildObsidianXmlRecord, trimTrailingTextAfterToolBlocks } from "./tool-output.js";
import {
  applyProxyTraceHeaders,
  ensureReqId,
  setHttpContext,
  getHttpContext,
} from "../../lib/request-context.js";
import { logHttpRequest } from "../../dev-trace/http.js";
import { createStreamObserver } from "../../services/metrics/index.js";
import { startSpan, endSpan } from "../../services/tracing.js";
import { toolBufferMetrics } from "../../services/metrics/chat.js";
import { maybeInjectIngressGuardrail } from "../../lib/ingress-guardrail.js";
import {
  createToolBufferTracker,
  trackToolBufferOpen,
  detectNestedToolBuffer,
  clampEmittableIndex,
  completeToolBuffer,
  abortToolBuffer,
  shouldSkipBlock,
} from "./tool-buffer.js";
import { createChatStreamCapture } from "./capture.js";
import {
  summarizeTextParts,
  summarizeToolCalls,
} from "../../lib/observability/transform-summary.js";
import { logStructured } from "../../services/logging/schema.js";

const DEFAULT_MODEL = CFG.CODEX_MODEL;
const SANDBOX_MODE = CFG.PROXY_SANDBOX_MODE;
const CODEX_WORKDIR = CFG.PROXY_CODEX_WORKDIR;
const FORCE_PROVIDER = CFG.CODEX_FORCE_PROVIDER.trim();
const IS_DEV_ENV = (CFG.PROXY_ENV || "").toLowerCase() === "dev";
const ACCEPTED_MODEL_IDS = acceptedModelIds(DEFAULT_MODEL);
const STOP_AFTER_TOOLS = CFG.PROXY_STOP_AFTER_TOOLS;
const STOP_AFTER_TOOLS_MODE = CFG.PROXY_STOP_AFTER_TOOLS_MODE;
const STOP_AFTER_TOOLS_GRACE_MS = CFG.PROXY_STOP_AFTER_TOOLS_GRACE_MS;
const STOP_AFTER_TOOLS_MAX = Number(CFG.PROXY_TOOL_BLOCK_MAX || 0);
const ENFORCE_STOP_AFTER_TOOLS =
  STOP_AFTER_TOOLS || STOP_AFTER_TOOLS_MAX > 0 || STOP_AFTER_TOOLS_MODE === "first";
const SUPPRESS_TAIL_AFTER_TOOLS = CFG.PROXY_SUPPRESS_TAIL_AFTER_TOOLS;
const REQ_TIMEOUT_MS = CFG.PROXY_TIMEOUT_MS;
const KILL_ON_DISCONNECT = CFG.PROXY_KILL_ON_DISCONNECT.toLowerCase() !== "false";
const STREAM_IDLE_TIMEOUT_MS = CFG.PROXY_STREAM_IDLE_TIMEOUT_MS;
const CORS_ENABLED = CFG.PROXY_ENABLE_CORS.toLowerCase() !== "false";
const CORS_ALLOWED = CFG.PROXY_CORS_ALLOWED_ORIGINS;
const applyCors = (req, res) => applyCorsUtil(req, res, CORS_ENABLED, CORS_ALLOWED);
const TEST_ENDPOINTS_ENABLED = CFG.PROXY_TEST_ENDPOINTS;
const MAX_CHAT_CHOICES = Math.max(1, Number(CFG.PROXY_MAX_CHAT_CHOICES || 1));
const ENABLE_PARALLEL_TOOL_CALLS = IS_DEV_ENV && CFG.PROXY_ENABLE_PARALLEL_TOOL_CALLS;
const SANITIZE_METADATA = !!CFG.PROXY_SANITIZE_METADATA;
const APPROVAL_POLICY = CFG.PROXY_APPROVAL_POLICY;

const logUsageFailure = ({
  req,
  res,
  reqId,
  started,
  route,
  mode,
  statusCode,
  reason = "error",
  errorCode,
  requestedModel,
  effectiveModel,
  stream = true,
}) => {
  try {
    const ctx = getHttpContext(res) || {};
    appendUsage({
      req_id: reqId,
      route: ctx.route || route,
      mode: ctx.mode || mode,
      method: req.method || "POST",
      status_code: statusCode,
      status: statusCode,
      stream,
      requested_model: requestedModel,
      effective_model: effectiveModel,
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      prompt_tokens_est: 0,
      completion_tokens_est: 0,
      total_tokens_est: 0,
      duration_ms: Math.max(Date.now() - started, 0),
      emission_trigger: reason,
      usage_included: false,
      user_agent: req.headers["user-agent"] || "",
      error_code: errorCode,
    });
  } catch (err) {
    if (IS_DEV_ENV) {
      console.error("[dev][usage][stream] failed to append usage", err);
    }
  }
};

const buildInvalidChoiceError = (value) =>
  invalidRequestBody(
    "n",
    `n must be an integer between 1 and ${MAX_CHAT_CHOICES}; received ${value}`
  );

const normalizeChoiceCount = (raw) => {
  if (raw === undefined || raw === null) return { ok: true, value: 1 };
  if (typeof raw === "number" && Number.isInteger(raw)) {
    return { ok: true, value: raw };
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    if (Number.isInteger(parsed)) {
      return { ok: true, value: parsed };
    }
  }
  return { ok: false, error: buildInvalidChoiceError(raw) };
};

// POST /v1/chat/completions with stream=true
export async function postChatStream(req, res) {
  const route = res.locals?.routeOverride || "/v1/chat/completions";
  const mode = res.locals?.modeOverride || "chat_stream";
  setHttpContext(res, { route, mode });
  const reqId = ensureReqId(res);
  applyProxyTraceHeaders(res);
  const started = Date.now();
  let responded = false;
  let responseWritable = true;

  const streamAdapter = res.locals?.streamAdapter || null;
  const invokeAdapter = (method, ...args) => {
    if (!streamAdapter) return undefined;
    if (method === "onChunk" && typeof streamAdapter.onChunk === "function") {
      try {
        return streamAdapter.onChunk(...args);
      } catch (err) {
        console.error("[proxy][chat.stream] stream adapter onChunk failed", err);
        return undefined;
      }
    }
    if (method === "onDone" && typeof streamAdapter.onDone === "function") {
      try {
        return streamAdapter.onDone(...args);
      } catch (err) {
        console.error("[proxy][chat.stream] stream adapter onDone failed", err);
        return undefined;
      }
    }
    return undefined;
  };

  const body = req.body || {};
  const originalBody = (() => {
    try {
      return structuredClone(body);
    } catch {
      try {
        return JSON.parse(JSON.stringify(body));
      } catch {
        return {};
      }
    }
  })();
  logHttpRequest({
    req,
    res,
    route,
    mode,
    body,
  });
  const model = requireModel({
    req,
    res,
    body,
    reqId,
    started,
    route: "/v1/chat/completions",
    mode: "chat_stream",
    logUsageFailure,
    applyCors,
    sendJson: (statusCode, payload) => res.status(statusCode).json(payload),
  });
  if (!model) return;
  // Global SSE concurrency guard (per-process). Deterministic for tests.
  const MAX_CONC = Number(CFG.PROXY_SSE_MAX_CONCURRENCY || 0) || 0;
  let messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) {
    logUsageFailure({
      req,
      res,
      reqId,
      started,
      route: "/v1/chat/completions",
      mode: "chat_stream",
      statusCode: 400,
      reason: "invalid_request",
      errorCode: "messages_required",
    });
    applyCors(req, res);
    return res.status(400).json({
      error: {
        message: "messages[] required",
        type: "invalid_request_error",
        param: "messages",
        code: "invalid_request_error",
      },
    });
  }

  const guardrailResult = maybeInjectIngressGuardrail({
    req,
    res,
    messages,
    enabled: CFG.PROXY_INGRESS_GUARDRAIL,
    route,
    mode,
    endpointMode: res.locals?.endpoint_mode || "chat_completions",
  });
  if (guardrailResult.injected) {
    messages = guardrailResult.messages;
  }
  const { copilotDetection } = resolveChatCopilotDetection({
    headers: req?.headers,
    messages,
    markers: guardrailResult.markers,
  });
  res.locals.copilot_detected = copilotDetection.copilot_detected;
  res.locals.copilot_detect_tier = copilotDetection.copilot_detect_tier;
  res.locals.copilot_detect_reasons = copilotDetection.copilot_detect_reasons;

  const {
    ok: choiceOk,
    value: requestedChoiceCount = 1,
    error: choiceError,
  } = normalizeChoiceCount(body.n);
  if (!choiceOk) {
    logUsageFailure({
      req,
      res,
      reqId,
      started,
      route: "/v1/chat/completions",
      mode: "chat_stream",
      statusCode: 400,
      reason: "invalid_request",
      errorCode: choiceError?.error?.code || "invalid_choice",
    });
    applyCors(req, res);
    return res.status(400).json(choiceError);
  }
  if (requestedChoiceCount < 1 || requestedChoiceCount > MAX_CHAT_CHOICES) {
    logUsageFailure({
      req,
      res,
      reqId,
      started,
      route: "/v1/chat/completions",
      mode: "chat_stream",
      statusCode: 400,
      reason: "invalid_request",
      errorCode: "invalid_choice_range",
    });
    applyCors(req, res);
    return res.status(400).json(buildInvalidChoiceError(requestedChoiceCount));
  }
  const choiceCount = requestedChoiceCount;
  const choiceStates = new Map();
  let metadataSanitizer = null;
  let usageTracker = null;
  let textualToolCount = 0;

  const ensureChoiceState = (choiceIndex = 0) => {
    const normalized = Number.isInteger(choiceIndex) && choiceIndex >= 0 ? choiceIndex : 0;
    if (!choiceStates.has(normalized)) {
      choiceStates.set(normalized, {
        index: normalized,
        emitted: "",
        forwardedUpTo: 0,
        scanPos: 0,
        lastToolEnd: -1,
        textualToolContentSeen: false,
        dropAssistantContentAfterTools: false,
        sentAny: false,
        hasToolEvidence: false,
        structuredCount: 0,
        forwardedToolCount: 0,
        toolBuffer: createToolBufferTracker(),
      });
    }
    return choiceStates.get(normalized);
  };

  const forEachTrackedChoice = (callback) => {
    const indices = new Set();
    for (let idx = 0; idx < choiceCount; idx += 1) indices.add(idx);
    choiceStates.forEach((_state, idx) => indices.add(idx));
    if (metadataSanitizer?.listChoiceIndexes) {
      metadataSanitizer.listChoiceIndexes().forEach((idx) => indices.add(idx));
    }
    if (!indices.size) indices.add(0);
    Array.from(indices)
      .sort((a, b) => a - b)
      .forEach((idx) => callback(idx));
  };
  const outputMode = resolveOutputMode({
    headerValue: req.headers["x-proxy-output-mode"],
    defaultValue: CFG.PROXY_OUTPUT_MODE,
    copilotDefault: "obsidian-xml",
    copilotDetection: CFG.PROXY_COPILOT_AUTO_DETECT ? copilotDetection : null,
  });
  res.setHeader("x-proxy-output-mode", outputMode);
  const isObsidianOutput = outputMode === "obsidian-xml";
  res.locals.output_mode_requested = req.headers["x-proxy-output-mode"]
    ? String(req.headers["x-proxy-output-mode"])
    : null;
  res.locals.output_mode_effective = outputMode;
  if (!res.locals.endpoint_mode) res.locals.endpoint_mode = "chat";

  const streamCapture =
    res.locals.endpoint_mode === "responses"
      ? null
      : createChatStreamCapture({
          req,
          res,
          requestBody: originalBody,
          outputModeEffective: outputMode,
        });
  let captureFinalized = false;
  const finalizeCapture = (outcome) => {
    if (captureFinalized || !streamCapture) return;
    captureFinalized = true;
    streamCapture.finalize(outcome);
  };

  const backendMode = selectBackendMode();

  const optionalValidation = validateOptionalChatParams(body, {
    allowJsonSchema: true,
  });
  if (!optionalValidation.ok) {
    logUsageFailure({
      req,
      res,
      reqId,
      started,
      route: "/v1/chat/completions",
      mode: "chat_stream",
      statusCode: 400,
      reason: "invalid_optional_params",
      errorCode: optionalValidation.error?.error?.code,
    });
    applyCors(req, res);
    return res.status(400).json(optionalValidation.error);
  }

  const { requested: requestedModel, effective: effectiveModel } = normalizeModel(
    model,
    DEFAULT_MODEL,
    Array.from(ACCEPTED_MODEL_IDS)
  );
  try {
    console.log(
      `[proxy] model requested=${requestedModel} effective=${effectiveModel} stream=${!!body.stream}`
    );
  } catch {}
  if (!ACCEPTED_MODEL_IDS.has(requestedModel)) {
    logUsageFailure({
      req,
      res,
      reqId,
      started,
      route: "/v1/chat/completions",
      mode: "chat_stream",
      statusCode: 404,
      reason: "model_not_found",
      errorCode: "model_not_found",
      requestedModel,
    });
    applyCors(req, res);
    return res.status(404).json(modelNotFoundBody(requestedModel));
  }

  const streamObserver = createStreamObserver({ route, model: effectiveModel });
  let streamOutcomeRecorded = false;
  const recordStreamOutcome = (outcome) => {
    if (streamOutcomeRecorded) return;
    streamOutcomeRecorded = true;
    streamObserver.end(outcome);
  };
  let reasoningEffort = (
    body.reasoning?.effort ||
    body.reasoning_effort ||
    body.reasoningEffort ||
    ""
  )
    .toString()
    .toLowerCase();
  const allowEffort = new Set(["low", "medium", "high", "xhigh"]);
  if (!reasoningEffort) {
    const implied = impliedEffortForModel(requestedModel);
    if (implied) reasoningEffort = implied;
  }

  const args = buildBackendArgs({
    backendMode,
    SANDBOX_MODE,
    effectiveModel,
    FORCE_PROVIDER,
    reasoningEffort,
    allowEffort,
    enableParallelTools: ENABLE_PARALLEL_TOOL_CALLS,
  });

  const prompt = joinMessages(messages);
  const promptTokensEst = estTokensForMessages(messages);
  const MAX_TOKENS = CFG.PROXY_MAX_PROMPT_TOKENS;
  if (MAX_TOKENS > 0 && promptTokensEst > MAX_TOKENS) {
    logUsageFailure({
      req,
      res,
      reqId,
      started,
      route: "/v1/chat/completions",
      mode: "chat_stream",
      statusCode: 403,
      reason: "tokens_exceeded",
      requestedModel,
      effectiveModel,
      errorCode: "prompt_too_large",
    });
    applyCors(req, res);
    return res.status(403).json(tokensExceededBody("messages"));
  }

  const guardContext = setupStreamGuard({
    res,
    reqId,
    route: "/v1/chat/completions",
    maxConc: MAX_CONC,
    testEndpointsEnabled: TEST_ENDPOINTS_ENABLED,
    send429: () => {
      applyCors(req, res);
      logUsageFailure({
        req,
        res,
        reqId,
        started,
        route: "/v1/chat/completions",
        mode: "chat_stream",
        statusCode: 429,
        reason: "concurrency_exceeded",
        errorCode: "concurrency_exceeded",
      });
      res.status(429).json({
        error: {
          message: "too many concurrent streams",
          type: "rate_limit_error",
          code: "concurrency_exceeded",
        },
      });
    },
  });

  if (!guardContext.acquired) {
    return;
  }

  const releaseGuard = (outcome) => guardContext.release(outcome);
  applyGuardHeaders(res, guardContext.token, TEST_ENDPOINTS_ENABLED);

  if (IS_DEV_ENV) {
    const endpointMode = res.locals?.endpoint_mode || "chat";
    const prefix = `[dev][prompt][chat][req_id=${reqId}][endpoint=${endpointMode}]`;
    try {
      console.log(`${prefix} messages=`, JSON.stringify(messages));
      console.log(`${prefix} joined=\n` + prompt);
      appendProtoEvent({
        ts: Date.now(),
        req_id: reqId,
        route: "/v1/chat/completions",
        mode: "chat",
        kind: "submission",
        payload: { messages, joined: prompt },
      });
    } catch (e) {
      console.error(`${prefix} error:`, e);
    }
  }

  try {
    console.log(
      `[proxy] spawning backend=${backendMode}:`,
      resolvedCodexBin,
      args.join(" "),
      " prompt_len=",
      prompt.length
    );
  } catch {}
  let normalizedRequest = null;
  try {
    normalizedRequest = normalizeChatJsonRpcRequest({
      body,
      messages,
      prompt,
      effectiveModel,
      choiceCount,
      stream: true,
      reasoningEffort,
      sandboxMode: SANDBOX_MODE,
      codexWorkdir: CODEX_WORKDIR,
      approvalMode: APPROVAL_POLICY,
    });
  } catch (err) {
    if (err instanceof ChatJsonRpcNormalizationError) {
      if (!responded) {
        responded = true;
        releaseGuard("normalization_error");
      }
      logUsageFailure({
        req,
        res,
        reqId,
        started,
        route: "/v1/chat/completions",
        mode: "chat_stream",
        statusCode: err.statusCode || 400,
        reason: "normalization_error",
        errorCode: err.body?.error?.code || err.code,
        requestedModel,
        effectiveModel,
      });
      applyCors(req, res);
      return res.status(err.statusCode).json(err.body);
    }
    if (!responded) {
      releaseGuard("normalization_error");
    }
    applyCors(req, res);
    throw err;
  }

  const traceContext = { reqId, route: "/v1/chat/completions", mode: "chat_stream" };
  const child = createJsonRpcChildAdapter({
    reqId,
    timeoutMs: REQ_TIMEOUT_MS,
    normalizedRequest,
    trace: traceContext,
  });
  const backendSpan = startSpan("backend.invoke", {
    "proxy.route": route,
    "proxy.backend_mode": backendMode,
    "proxy.model.effective": effectiveModel,
  });
  let backendSpanEnded = false;
  const endBackendSpan = (outcome) => {
    if (!backendSpan || backendSpanEnded) return;
    backendSpanEnded = true;
    try {
      backendSpan.setAttribute("proxy.backend.outcome", outcome || "unknown");
    } catch {}
    endSpan(backendSpan);
  };

  const onChildError = (error) => {
    try {
      console.log("[proxy] child error:", error?.message || String(error));
    } catch {}
    if (responded) return;
    try {
      clearTimeout(timeout);
    } catch {}
    if (hasToolCallEvidence()) {
      finalizeStream({
        reason: "tool_calls",
        trigger: usageTracker?.getTrigger?.() || "backend_error",
      });
      return;
    }
    responded = true;
    const mapped = mapTransportError(error);
    try {
      streamObserver.markFirst();
      if (mapped) {
        sendSSE(mapped.body);
      } else {
        sendSSE(sseErrorBody(error));
      }
    } catch {}
    finalizeCapture("failed");
    logUsageFailure({
      req,
      res,
      reqId,
      started,
      route: "/v1/chat/completions",
      mode: "chat_stream",
      statusCode: (mapped && mapped.statusCode) || 502,
      reason: "backend_error",
      errorCode: mapped?.body?.error?.code || "backend_error",
      requestedModel,
      effectiveModel,
    });
    try {
      finishSSEUtil(res);
    } catch {}
    try {
      releaseGuard("error");
    } catch {}
    const outcome = mapped?.body?.error?.code || "backend_error";
    recordStreamOutcome(outcome);
    endBackendSpan(outcome);
  };
  child.on("error", onChildError);
  const timeout = setTimeout(() => {
    if (responded) return;
    onChildError(new Error("request timeout"));
    try {
      child.kill("SIGKILL");
    } catch {}
  }, REQ_TIMEOUT_MS);

  let out = "";

  const sendSSE = (payload) => {
    try {
      if (!responseWritable) return;
      streamObserver.markFirst();
      sendSSEUtil(res, payload);
    } catch {}
  };
  const sendSSEKeepalive = () => {
    sendCommentUtil(res, `keepalive ${Date.now()}`);
  };
  const finishSSE = () => {
    if (invokeAdapter("onDone") === true) return;
    if (streamCapture) streamCapture.recordDone();
    finishSSEUtil(res);
  };
  const emitToolStatsComment = (payload) => {
    if (!payload || responseWritable === false) return;
    try {
      sendCommentUtil(res, JSON.stringify(payload));
    } catch {}
  };

  // Stable id across stream
  const completionId = `chatcmpl-${nanoid()}`;
  const created = Math.floor(Date.now() / 1000);
  let firstTokenAt = null;
  const markFirstToken = () => {
    if (firstTokenAt !== null) return;
    firstTokenAt = Date.now();
  };
  const markFirstTokenFromPayload = (payload) => {
    if (firstTokenAt !== null) return;
    if (!payload || typeof payload !== "object") return;
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    for (const choice of choices) {
      const delta = choice?.delta || {};
      if (typeof delta.content === "string" && delta.content.length) {
        markFirstToken();
        return;
      }
      if (
        Array.isArray(delta.content) &&
        delta.content.some((item) => {
          if (!item) return false;
          if (typeof item === "string") return item.length > 0;
          if (typeof item.text === "string") return item.text.length > 0;
          return false;
        })
      ) {
        markFirstToken();
        return;
      }
      if (delta.text && typeof delta.text === "string" && delta.text.length) {
        markFirstToken();
        return;
      }
      if (Array.isArray(delta.tool_calls) && delta.tool_calls.length) {
        markFirstToken();
        return;
      }
      const functionCall = delta.function_call || delta.functionCall;
      if (functionCall && (functionCall.name || functionCall.arguments)) {
        markFirstToken();
        return;
      }
    }
  };
  const sendChunk = (payload) => {
    const chunkPayload = {
      id: completionId,
      object: "chat.completion.chunk",
      created,
      model: requestedModel,
      ...payload,
    };
    markFirstTokenFromPayload(chunkPayload);
    const handled = invokeAdapter("onChunk", chunkPayload);
    if (handled === true) return;
    if (streamCapture) streamCapture.record(chunkPayload);
    sendSSE(chunkPayload);
  };
  const buildChoiceFrames = (builder) => {
    if (choiceCount === 1) return [builder(0)];
    return Array.from({ length: choiceCount }, (_value, idx) => builder(idx));
  };
  const hasChoiceToolCalls = (choiceIndex = 0) => {
    const normalized = Number.isInteger(choiceIndex) && choiceIndex >= 0 ? choiceIndex : 0;
    const state = choiceStates.get(normalized);
    if (state?.hasToolEvidence) return true;
    return toolCallAggregator.hasCalls({ choiceIndex: normalized });
  };
  const determineChoiceFinishReason = (choiceIndex, fallbackReason) => {
    if (hasChoiceToolCalls(choiceIndex)) return "tool_calls";
    if (fallbackReason === "tool_calls") return "stop";
    return fallbackReason;
  };
  const sendChoiceDelta = (choiceIndex, delta, finishReason = null) => {
    const normalized = Number.isInteger(choiceIndex) && choiceIndex >= 0 ? choiceIndex : 0;
    const limitToolTail = (SUPPRESS_TAIL_AFTER_TOOLS || STOP_AFTER_TOOLS) && isObsidianOutput;
    let payloadDelta = delta;
    if (
      limitToolTail &&
      payloadDelta &&
      typeof payloadDelta === "object" &&
      typeof payloadDelta.content === "string"
    ) {
      const lastClose = payloadDelta.content.lastIndexOf("</use_tool>");
      if (lastClose >= 0) {
        const trimmed = payloadDelta.content.slice(0, lastClose + "</use_tool>".length).trim();
        if (trimmed !== payloadDelta.content) {
          const rest = { ...payloadDelta };
          delete rest.content;
          payloadDelta = trimmed ? { ...rest, content: trimmed } : rest;
          if (!Object.keys(payloadDelta).length) return;
        }
      }
    }
    sendChunk({
      choices: [
        {
          index: normalized,
          delta: payloadDelta,
          finish_reason: finishReason,
        },
      ],
      usage: null,
    });
  };
  const sendRoleOnce = (() => {
    let sent = false;
    return () => {
      if (sent) return;
      sent = true;
      sendChunk({
        choices: buildChoiceFrames((index) => ({
          index,
          delta: { role: "assistant" },
          finish_reason: null,
        })),
        usage: null,
      });
    };
  })();
  res.setHeader("x-codex-stop-after-tools-mode", STOP_AFTER_TOOLS_MODE || "burst");
  setSSEHeaders(res);

  let keepalive;
  let streamClosed = false;
  const keepaliveMs = computeKeepaliveMs(req);
  const clearKeepalive = () => {
    if (keepalive) {
      try {
        if (typeof keepalive.stop === "function") keepalive.stop();
        else clearInterval(keepalive);
      } catch {}
      keepalive = null;
    }
  };
  const cleanupStream = () => {
    if (streamClosed) return;
    streamClosed = true;
    clearKeepalive();
    stopIdleTimer();
    responseWritable = false;
    try {
      clearTimeout(timeout);
    } catch {}
    try {
      if (KILL_ON_DISCONNECT) child.kill("SIGTERM");
    } catch {}
    if (!streamOutcomeRecorded && !finalized) {
      recordStreamOutcome("client_abort");
    }
    if (!backendSpanEnded) endBackendSpan("client_abort");
    releaseGuard();
  };
  if (keepaliveMs > 0)
    keepalive = startKeepalives(res, keepaliveMs, () => {
      try {
        if (!streamClosed) sendSSEKeepalive();
      } catch {}
    });
  res.on("close", cleanupStream);
  res.on("finish", cleanupStream);
  req.on?.("aborted", cleanupStream);

  sendRoleOnce();
  let buf = "";
  const toolStats = { truncated: false };
  let lastToolStats = { count: 0, truncated: 0 };
  const includeUsage = !!(body?.stream_options?.include_usage || body?.include_usage);
  const toolCallAggregator = createToolCallAggregator();
  const toolNormalizer = createToolCallNormalizer();
  const cloneToolCallDelta = (delta) => {
    if (!delta || typeof delta !== "object") return {};
    const cloned = { ...delta };
    if (delta.function && typeof delta.function === "object") {
      cloned.function = { ...delta.function };
    }
    return cloned;
  };
  let appendContentSegment = () => {};
  let emitAggregatorToolContent = () => false;
  let flushDanglingToolBuffers = () => {};
  let hasTextualToolPrefix = () => false;

  const emitTextualToolMetadata = (choiceIndex, text) => {
    if (!text) return false;
    try {
      const ingestion = toolCallAggregator.ingestMessage(
        { message: { content: text } },
        { choiceIndex, emitIfMissing: true }
      );
      if (ingestion?.deltas?.length) {
        hasToolCallsFlag = true;
        const state = ensureChoiceState(choiceIndex);
        state.hasToolEvidence = true;
        state.structuredCount = toolCallAggregator.snapshot({ choiceIndex }).length;
        for (const toolDelta of ingestion.deltas) {
          sendChoiceDelta(choiceIndex, {
            tool_calls: [cloneToolCallDelta(toolDelta)],
          });
        }
        return true;
      }
    } catch (err) {
      if (IS_DEV_ENV) console.error("[dev][stream] textual tool metadata error", err);
    }
    return false;
  };
  let finishSent = false;
  let finalized = false;
  let hasToolCallsFlag = false;
  let hasFunctionCall = false;
  const hasToolCallEvidence = () => {
    if (hasToolCallsFlag || textualToolCount > 0 || toolCallAggregator.hasCalls()) return true;
    for (const state of choiceStates.values()) {
      if (state.hasToolEvidence) return true;
    }
    return false;
  };
  const unknownFinishReasons = new Set();
  let finalFinishReason = null;
  let finalFinishSource = null;
  let finalFinishTrail = [];
  let finalFinishUnknown = [];
  let lengthEvidence = false;
  const finishTracker = createFinishReasonTracker({
    fallback: "stop",
    onUnknown: (info) => {
      const value = info?.value || info?.raw;
      if (value) unknownFinishReasons.add(value);
    },
  });
  const { startIdleTimer, stopIdleTimer } = createStreamTimers({
    idleMs: STREAM_IDLE_TIMEOUT_MS,
    onIdle: () => {
      if (!finalized) trackFinishReason("length", "stream_idle_timeout");
      try {
        child.kill("SIGTERM");
      } catch {}
    },
  });
  startIdleTimer();

  const trackToolSignals = (payload) => {
    if (!payload || typeof payload !== "object") return;
    const toolCalls = payload.tool_calls || payload.toolCalls;
    if (Array.isArray(toolCalls) && toolCalls.length) hasToolCallsFlag = true;
    const functionCall = payload.function_call || payload.functionCall;
    if (functionCall && typeof functionCall === "object") hasFunctionCall = true;
    if (payload.message && typeof payload.message === "object") trackToolSignals(payload.message);
    if (payload.delta && typeof payload.delta === "object") trackToolSignals(payload.delta);
    if (Array.isArray(payload.deltas)) {
      for (const delta of payload.deltas) trackToolSignals(delta);
    }
    if (Array.isArray(payload.items)) {
      for (const item of payload.items) trackToolSignals(item);
    }
    if (payload.arguments && typeof payload.arguments === "object") {
      trackToolSignals(payload.arguments);
    }
  };

  const resolveFinishReason = (context = {}) => {
    const resolved = finishTracker.resolve({
      hasToolCalls: hasToolCallEvidence(),
      hasFunctionCall,
      ...context,
    });
    finalFinishReason = resolved.reason;
    finalFinishSource = resolved.source;
    finalFinishTrail = resolved.trail || [];
    finalFinishUnknown = resolved.unknown || [];
    return resolved;
  };

  const emitFinishChunk = (rawReason) => {
    if (finishSent) return finalFinishReason;
    if (rawReason) finishTracker.record(rawReason, "finalizer");
    const { reason } = resolveFinishReason();
    finishSent = true;
    sendChunk({
      choices: buildChoiceFrames((index) => ({
        index,
        delta: {},
        finish_reason: determineChoiceFinishReason(index, reason),
      })),
      usage: null,
    });
    return reason;
  };

  const trackFinishReason = (raw, source) => {
    if (raw === null || raw === undefined) return null;
    const canonical = finishTracker.record(raw, source);
    if (canonical === "length") lengthEvidence = true;
    return canonical;
  };

  const totalForwardedToolCount = () => {
    let total = 0;
    choiceStates.forEach((state) => {
      total += state.forwardedToolCount || 0;
    });
    return total;
  };

  const forwardedToolCountForChoice = (choiceIndex) => {
    if (!Number.isInteger(choiceIndex) || choiceIndex < 0) return 0;
    const state = choiceStates.get(choiceIndex);
    return state?.forwardedToolCount || 0;
  };

  const stopAfterToolsController = createStopAfterToolsController({
    enforce: ENFORCE_STOP_AFTER_TOOLS,
    stopAfterToolsMode: STOP_AFTER_TOOLS_MODE || "burst",
    stopAfterToolsMax: STOP_AFTER_TOOLS_MAX,
    graceMs: STOP_AFTER_TOOLS_GRACE_MS,
    getTotalForwardedToolCount: () => totalForwardedToolCount(),
    getChoiceForwardedToolCount: (choiceIndex) => forwardedToolCountForChoice(choiceIndex),
    onCutoff: () => {
      toolStats.truncated = true;
      try {
        clearKeepalive();
      } catch {}
      try {
        child.kill("SIGTERM");
      } catch {}
      if (!finalized) trackFinishReason("length", "tool_cutoff");
    },
  });

  const scheduleStopAfterTools = (choiceIndex = null) => {
    const resolvedIndex = Number.isInteger(choiceIndex) && choiceIndex >= 0 ? choiceIndex : null;
    stopAfterToolsController.schedule(resolvedIndex);
  };

  const logToolBufferWarning = (code, meta = {}) => {
    const payload = { event: "tool_buffer", code, req_id: reqId, ...meta };
    try {
      console.warn(`[proxy][chat.stream][tool-buffer] ${JSON.stringify(payload)}`);
    } catch {}
  };

  const outputCoordinator = createStreamOutputCoordinator({
    isObsidianOutput,
    outputMode,
    stopAfterTools: Boolean(STOP_AFTER_TOOLS),
    suppressTailAfterTools: Boolean(SUPPRESS_TAIL_AFTER_TOOLS),
    toolCallAggregator,
    toolBufferMetrics,
    ensureChoiceState,
    forEachChoice: forEachTrackedChoice,
    onTextualToolBlocks: (count) => {
      textualToolCount += count;
    },
    sendChoiceDelta,
    emitTextualToolMetadata,
    scheduleStopAfterTools,
    extractUseToolBlocks,
    trackToolBufferOpen,
    detectNestedToolBuffer,
    clampEmittableIndex,
    completeToolBuffer,
    abortToolBuffer,
    shouldSkipBlock,
    trimTrailingTextAfterToolBlocks,
    buildObsidianXmlRecord,
    logToolBufferWarning,
  });
  appendContentSegment = outputCoordinator.appendContentSegment;
  emitAggregatorToolContent = outputCoordinator.emitAggregatorToolContent;
  flushDanglingToolBuffers = outputCoordinator.flushDanglingToolBuffers;
  hasTextualToolPrefix = outputCoordinator.hasTextualToolPrefix;

  metadataSanitizer = createStreamMetadataSanitizer({
    sanitizeMetadata: SANITIZE_METADATA,
    reqId,
    route: "/v1/chat/completions",
    mode: "chat_stream",
    appendProtoEvent,
    logSanitizerToggle,
    metadataKeys,
    normalizeMetadataKey,
    sanitizeMetadataTextSegment,
    appendContentSegment: (...args) => appendContentSegment(...args),
    scheduleStopAfterTools: (...args) => scheduleStopAfterTools(...args),
  });
  const {
    enqueueSanitizedSegment,
    mergeMetadataInfo,
    applyMetadataSanitizer,
    recordSanitizedMetadata,
    flushSanitizedSegments,
    getSummaryData: getSanitizerSummaryData,
    emitSummaryProtoEvent,
  } = metadataSanitizer;

  const resolveFinishForUsage = () =>
    finalFinishReason
      ? { reason: finalFinishReason, source: finalFinishSource }
      : resolveFinishReason();

  const getEmittedLength = () =>
    Array.from(choiceStates.values()).reduce((sum, state) => sum + state.emitted.length, 0);

  usageTracker = createStreamUsageTracker({
    includeUsage,
    choiceCount,
    promptTokensEst,
    startedAt: started,
    getEmittedLength,
    getFirstTokenAt: () => firstTokenAt,
    sendChunk,
    appendUsage,
    logSanitizerSummary,
    getSanitizerSummaryData,
    resolveFinishReason: resolveFinishForUsage,
    hasToolCallEvidence,
    hasFunctionCall: () => hasFunctionCall,
    toolCallAggregator,
    getToolStats: () => lastToolStats,
    stopAfterToolsMode: STOP_AFTER_TOOLS_MODE || "burst",
    outputMode,
    req,
    res,
    reqId,
    route: "/v1/chat/completions",
    mode: "chat_stream",
    requestedModel,
    effectiveModel,
    getHttpContext,
    sanitizeMetadata: SANITIZE_METADATA,
    isDev: IS_DEV_ENV,
  });
  const updateUsageCounts = (...args) => usageTracker.updateUsageCounts(...args);
  const emitUsageChunk = (trigger) => usageTracker.emitUsageChunk(trigger);
  const logUsage = (trigger) => usageTracker.logUsage(trigger);
  const markUsageTriggerIfMissing = (trigger) => usageTracker.markTriggerIfMissing(trigger);

  const { emitDeltaFromRuntime, emitMessageFromRuntime } = createStreamRuntimeEmitter({
    sanitizeMetadata: SANITIZE_METADATA,
    coerceAssistantContent,
    toolCallAggregator,
    ensureChoiceState,
    isObsidianOutput,
    hasTextualToolPrefix,
    emitAggregatorToolContent,
    sendChoiceDelta,
    cloneToolCallDelta,
    logProto: LOG_PROTO,
    appendProtoEvent,
    reqId,
    enqueueSanitizedSegment,
    mergeMetadataInfo,
    applyMetadataSanitizer,
    appendContentSegment,
    emitTextualToolMetadata,
    scheduleStopAfterTools,
    markHasToolCalls: () => {
      hasToolCallsFlag = true;
    },
  });

  const streamRuntime = createStreamRuntime({
    output: {
      emitDelta: (choiceIndex, deltaPayload, context = {}) =>
        emitDeltaFromRuntime({
          choiceIndex,
          deltaPayload,
          metadataInfo: context.metadataInfo,
          eventType: context.eventType,
        }),
      emitMessage: (choiceIndex, finalMessage, context = {}) =>
        emitMessageFromRuntime({
          choiceIndex,
          finalMessage,
          metadataInfo: context.metadataInfo,
          eventType: context.eventType,
        }),
      emitUsage: () => {},
      emitFinish: () => {},
      emitError: () => {},
    },
    toolNormalizer,
    finishTracker,
  });
  const { handleParsedEvent } = wireStreamTransport({
    runtime: streamRuntime,
    resolveChoiceIndexFromPayload,
    extractMetadataFromPayload,
    sanitizeMetadata: SANITIZE_METADATA,
  });

  const shouldDropFunctionCallOutput = (payload = null) => {
    if (!payload || typeof payload !== "object") return false;
    const outputField = payload.output;
    return typeof outputField === "string" && outputField.includes("resources/list failed");
  };

  const finalizeStream = ({ reason, trigger } = {}) => {
    if (finalized) return;
    finalized = true;
    responded = true;
    try {
      stopAfterToolsController.cancel();
    } catch {}
    flushDanglingToolBuffers("finalize");
    flushSanitizedSegments({ stage: "agent_message_delta", eventType: "finalize" });
    const resolvedTrigger =
      trigger ||
      usageTracker.getTrigger() ||
      (includeUsage ? (finishSent ? "task_complete" : "token_count") : "task_complete");
    if (reason) trackFinishReason(reason, "finalize");
    const resolvedFinish = resolveFinishReason();
    const forwardedToolCount = totalForwardedToolCount();
    const truncatedTotal = toolStats.truncated ? 1 : 0;
    lastToolStats = { count: forwardedToolCount, truncated: truncatedTotal };
    if (forwardedToolCount > 0 || truncatedTotal > 0) {
      emitToolStatsComment({
        tool_call_count: forwardedToolCount,
        tool_call_truncated: truncatedTotal > 0,
        stop_after_tools_mode: STOP_AFTER_TOOLS_MODE || "burst",
      });
    }
    if (!finishSent) emitFinishChunk();
    if (!usageTracker.hasEmitted() && includeUsage) emitUsageChunk(resolvedTrigger);
    if (!usageTracker.hasLogged()) logUsage(resolvedTrigger);
    if (toolCallAggregator.hasCalls()) {
      try {
        const summaries = [];
        forEachTrackedChoice((idx) => {
          const snapshot = toolCallAggregator.snapshot({ choiceIndex: idx });
          if (snapshot.length) {
            summaries.push({ choice_index: idx, tool_calls: snapshot });
          }
        });
        const flattened = summaries.flatMap((entry) =>
          entry.tool_calls.map((record) => ({ ...record, choice_index: entry.choice_index }))
        );
        appendProtoEvent({
          ts: Date.now(),
          req_id: reqId,
          route: "/v1/chat/completions",
          mode: "chat_stream",
          kind: "tool_call_summary",
          tool_calls: flattened,
          tool_calls_by_choice: summaries,
          parallel_supported: toolCallAggregator.supportsParallelCalls(),
          tool_call_count_total: lastToolStats.count,
          tool_call_truncated_total: lastToolStats.truncated,
          stop_after_tools_mode: STOP_AFTER_TOOLS_MODE || "burst",
          stop_after_tools_enabled: Boolean(STOP_AFTER_TOOLS),
          tool_block_max: STOP_AFTER_TOOLS_MAX,
          suppress_tail_after_tools: Boolean(SUPPRESS_TAIL_AFTER_TOOLS),
        });
      } catch {}
    }
    logFinishReasonTelemetry({
      route: "/v1/chat/completions",
      reqId,
      reason: resolvedFinish.reason,
      source: resolvedFinish.source,
      hasToolCalls: hasToolCallEvidence(),
      hasFunctionCall,
      unknownReasons: finalFinishUnknown.length
        ? finalFinishUnknown
        : Array.from(unknownFinishReasons),
      trail: finalFinishTrail,
      choiceCount,
    });
    emitSummaryProtoEvent();
    const outcome = resolvedFinish.reason || "ok";
    try {
      const outputParts = [];
      forEachTrackedChoice((idx) => {
        const state = ensureChoiceState(idx);
        if (state && typeof state.emitted === "string") {
          outputParts.push(state.emitted);
        }
      });
      const textSummary = summarizeTextParts(outputParts);
      const flattened = [];
      forEachTrackedChoice((idx) => {
        const snapshot = toolCallAggregator.snapshot({ choiceIndex: idx });
        snapshot.forEach((record) => flattened.push(record));
      });
      const toolSummary = summarizeToolCalls(flattened);
      logStructured(
        {
          component: "chat",
          event: "chat_transform_summary",
          level: "info",
          req_id: reqId,
          trace_id: res.locals?.trace_id,
          route: "/v1/chat/completions",
          mode: "chat_stream",
          model: requestedModel,
        },
        {
          endpoint_mode: res.locals?.endpoint_mode || "chat",
          copilot_trace_id: res.locals?.copilot_trace_id || null,
          output_mode_requested: res.locals?.output_mode_requested ?? null,
          output_mode_effective: res.locals?.output_mode_effective ?? null,
          response_shape_version: "chat_v1_stream_openai",
          finish_reason: resolvedFinish.reason || null,
          status: 200,
          tool_calls_detected: hasToolCallEvidence() ? toolSummary.tool_call_count : 0,
          tool_calls_emitted: toolSummary.tool_call_count,
          tool_names: toolSummary.tool_names,
          tool_names_truncated: toolSummary.tool_names_truncated,
          output_text_bytes: textSummary.output_text_bytes,
          output_text_hash: textSummary.output_text_hash,
          xml_in_text: textSummary.xml_in_text,
          tool_use_items: 0,
        }
      );
    } catch {}
    finalizeCapture(outcome === "ok" ? "completed" : outcome);
    recordStreamOutcome(outcome);
    endBackendSpan(outcome);
    try {
      finishSSE();
    } catch {}
    cleanupStream();
    try {
      child.kill("SIGTERM");
    } catch {}
  };

  const eventRouter = createStreamEventRouter({
    parseStreamEventLine,
    extractMetadataFromPayload,
    sanitizeMetadata: SANITIZE_METADATA,
    appendProtoEvent,
    reqId,
    route: "/v1/chat/completions",
    mode: "chat_stream",
    handleParsedEvent,
    trackToolSignals,
    extractFinishReasonFromMessage,
    trackFinishReason,
    updateUsageCounts,
    mergeMetadataInfo,
    recordSanitizedMetadata,
    shouldDropFunctionCallOutput,
    getUsageTrigger: () => usageTracker.getTrigger(),
    markUsageTriggerIfMissing,
    hasAnyChoiceSent: () => Array.from(choiceStates.values()).some((state) => state.sentAny),
    hasLengthEvidence: () => lengthEvidence,
    emitFinishChunk,
    finalizeStream,
  });

  child.stdout.on("data", (chunk) => {
    if (finalized) return;
    startIdleTimer();
    const s = chunk.toString("utf8");
    out += s;
    buf += s;
    if (LOG_PROTO) {
      appendProtoEvent({
        ts: Date.now(),
        req_id: reqId,
        route: "/v1/chat/completions",
        mode: "chat_stream",
        kind: "stdout",
        chunk: s,
      });
    }
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      try {
        const result = eventRouter.handleLine(line);
        if (result?.stop) return;
      } catch {
        // ignore parse errors
      }
    }
  });
  child.stderr.on("data", (e) => {
    try {
      appendProtoEvent({
        ts: Date.now(),
        req_id: reqId,
        route: "/v1/chat/completions",
        mode: "chat_stream",
        kind: "stderr",
        chunk: e.toString("utf8"),
      });
    } catch {}
  });
  try {
    const submission = {
      id: reqId,
      op: { type: "user_input", items: [{ type: "text", text: prompt }] },
    };
    child.stdin.write(JSON.stringify(submission) + "\n");
  } catch {}
  const handleChildClose = () => {
    flushSanitizedSegments({ stage: "agent_message_delta", eventType: "close" });
    flushDanglingToolBuffers("disconnect");
    if (finalized) return;
    const usageTrigger = usageTracker.getTrigger();
    if (!finishSent && usageTrigger === "token_count" && !lengthEvidence) {
      trackFinishReason("stop", "token_count_fallback");
    }
    const anyChoiceSent = Array.from(choiceStates.values()).some((state) => state.sentAny);
    if (!anyChoiceSent) {
      const content = stripAnsi(out).trim();
      if (content) {
        sendChunk({
          choices: buildChoiceFrames((index) => ({
            index,
            delta: { content },
            finish_reason: null,
          })),
          usage: null,
        });
        forEachTrackedChoice((idx) => {
          const state = ensureChoiceState(idx);
          state.sentAny = true;
          state.emitted += content;
          state.forwardedUpTo = state.emitted.length;
        });
        if (IS_DEV_ENV) {
          try {
            console.log("[dev][response][chat][stream] content=\n" + content);
          } catch (e) {
            console.error("[dev][response][chat][stream] error:", e);
          }
        }
      }
    }
    const trigger = usageTrigger || (includeUsage ? "token_count" : "close");
    const inferredReason = finishSent ? finalFinishReason : lengthEvidence ? "length" : "stop";
    finalizeStream({ reason: inferredReason, trigger });
  };
  child.on("close", handleChildClose);
  child.on?.("exit", handleChildClose);
}
