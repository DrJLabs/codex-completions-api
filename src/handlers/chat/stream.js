import { spawnCodex, resolvedCodexBin } from "../../services/codex-runner.js";
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
  resolveOutputMode,
} from "./shared.js";
import { createToolCallAggregator, toObsidianXml } from "../../lib/tool-call-aggregator.js";
import { applyGuardHeaders, setupStreamGuard } from "../../services/concurrency-guard.js";
import {
  extractMetadataFromPayload,
  sanitizeMetadataTextSegment,
  metadataKeys,
  normalizeMetadataKey,
} from "../../lib/metadata-sanitizer.js";
import { selectBackendMode, BACKEND_APP_SERVER } from "../../services/backend-mode.js";
import { mapTransportError } from "../../services/transport/index.js";
import { createJsonRpcChildAdapter } from "../../services/transport/child-adapter.js";
import { normalizeChatJsonRpcRequest, ChatJsonRpcNormalizationError } from "./request.js";
import { requireModel } from "./require-model.js";
import { createStopAfterToolsController } from "./stop-after-tools-controller.js";
import { ensureReqId, setHttpContext, getHttpContext } from "../../lib/request-context.js";
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

const DEFAULT_MODEL = CFG.CODEX_MODEL;
const SANDBOX_MODE = CFG.PROXY_SANDBOX_MODE;
const CODEX_WORKDIR = CFG.PROXY_CODEX_WORKDIR;
const FORCE_PROVIDER = CFG.CODEX_FORCE_PROVIDER.trim();
const IS_DEV_ENV = (CFG.PROXY_ENV || "").toLowerCase() === "dev";
const ACCEPTED_MODEL_IDS = acceptedModelIds(DEFAULT_MODEL);
const STOP_AFTER_TOOLS = CFG.PROXY_STOP_AFTER_TOOLS;
const STOP_AFTER_TOOLS_MODE = CFG.PROXY_STOP_AFTER_TOOLS_MODE;
const STOP_AFTER_TOOLS_GRACE_MS = Number(process.env.PROXY_STOP_AFTER_TOOLS_GRACE_MS || 300);
const STOP_AFTER_TOOLS_MAX = Number(CFG.PROXY_TOOL_BLOCK_MAX || 0);
const ENFORCE_STOP_AFTER_TOOLS =
  STOP_AFTER_TOOLS || STOP_AFTER_TOOLS_MAX > 0 || STOP_AFTER_TOOLS_MODE === "first";
const SUPPRESS_TAIL_AFTER_TOOLS = CFG.PROXY_SUPPRESS_TAIL_AFTER_TOOLS;
const REQ_TIMEOUT_MS = CFG.PROXY_TIMEOUT_MS;
const KILL_ON_DISCONNECT = CFG.PROXY_KILL_ON_DISCONNECT.toLowerCase() !== "false";
const STREAM_IDLE_TIMEOUT_MS = CFG.PROXY_STREAM_IDLE_TIMEOUT_MS;
const DEBUG_PROTO = /^(1|true|yes)$/i.test(String(CFG.PROXY_DEBUG_PROTO || ""));
const CORS_ENABLED = CFG.PROXY_ENABLE_CORS.toLowerCase() !== "false";
const CORS_ALLOWED = CFG.PROXY_CORS_ALLOWED_ORIGINS;
const applyCors = (req, res) => applyCorsUtil(req, res, CORS_ENABLED, CORS_ALLOWED);
const TEST_ENDPOINTS_ENABLED = CFG.PROXY_TEST_ENDPOINTS;
const MAX_CHAT_CHOICES = Math.max(1, Number(CFG.PROXY_MAX_CHAT_CHOICES || 1));
const ENABLE_PARALLEL_TOOL_CALLS = IS_DEV_ENV && CFG.PROXY_ENABLE_PARALLEL_TOOL_CALLS;
const SANITIZE_METADATA = !!CFG.PROXY_SANITIZE_METADATA;
const APPROVAL_POLICY = (() => {
  const raw = process.env.PROXY_APPROVAL_POLICY ?? process.env.CODEX_APPROVAL_POLICY ?? "never";
  const normalized = String(raw).trim().toLowerCase();
  return normalized || "never";
})();

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
  const sanitizedContentStates = new Map();
  let textualToolCount = 0;

  const toChoiceIndex = (value) => {
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 ? n : null;
  };

  const extractChoiceIndex = (candidate, visited = new WeakSet()) => {
    if (!candidate || typeof candidate !== "object") return null;
    if (visited.has(candidate)) return null;
    visited.add(candidate);
    if (Object.prototype.hasOwnProperty.call(candidate, "choice_index")) {
      const idx = toChoiceIndex(candidate.choice_index);
      if (idx !== null) return idx;
    }
    if (Object.prototype.hasOwnProperty.call(candidate, "choiceIndex")) {
      const idx = toChoiceIndex(candidate.choiceIndex);
      if (idx !== null) return idx;
    }
    const nestedSources = [candidate.msg, candidate.message, candidate.delta, candidate.payload];
    for (const source of nestedSources) {
      const resolved = extractChoiceIndex(source, visited);
      if (resolved !== null) return resolved;
    }
    if (Array.isArray(candidate.choices)) {
      for (const choice of candidate.choices) {
        const resolved = extractChoiceIndex(choice, visited);
        if (resolved !== null) return resolved;
      }
    }
    return null;
  };

  const resolveChoiceIndexFromPayload = (...candidates) => {
    for (const candidate of candidates) {
      const idx = extractChoiceIndex(candidate);
      if (idx !== null) return idx;
    }
    return 0;
  };

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

  const getSanitizedContentState = (choiceIndex = 0) => {
    const normalized = Number.isInteger(choiceIndex) && choiceIndex >= 0 ? choiceIndex : 0;
    if (!sanitizedContentStates.has(normalized)) {
      sanitizedContentStates.set(normalized, {
        pending: "",
        lastContext: { stage: "agent_message_delta", eventType: "agent_message_delta" },
      });
    }
    return sanitizedContentStates.get(normalized);
  };

  const forEachTrackedChoice = (callback) => {
    const indices = new Set();
    for (let idx = 0; idx < choiceCount; idx += 1) indices.add(idx);
    choiceStates.forEach((_state, idx) => indices.add(idx));
    sanitizedContentStates.forEach((_state, idx) => indices.add(idx));
    if (!indices.size) indices.add(0);
    Array.from(indices)
      .sort((a, b) => a - b)
      .forEach((idx) => callback(idx));
  };
  const outputMode = resolveOutputMode({
    headerValue: req.headers["x-proxy-output-mode"],
    defaultValue: CFG.PROXY_OUTPUT_MODE,
  });
  res.setHeader("x-proxy-output-mode", outputMode);
  const isObsidianOutput = outputMode === "obsidian-xml";

  const backendMode = selectBackendMode();
  const isAppServerBackend = backendMode === BACKEND_APP_SERVER;

  const optionalValidation = validateOptionalChatParams(body, {
    allowJsonSchema: isAppServerBackend,
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
  const allowEffort = new Set(["low", "medium", "high", "xhigh", "minimal"]);
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
  if (isAppServerBackend) {
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
      throw err;
    }
  }

  const traceContext = { reqId, route: "/v1/chat/completions", mode: "chat_stream" };
  const child = isAppServerBackend
    ? createJsonRpcChildAdapter({
        reqId,
        timeoutMs: REQ_TIMEOUT_MS,
        normalizedRequest,
        trace: traceContext,
      })
    : spawnCodex(args, {
        reqId,
        route: traceContext.route,
        mode: traceContext.mode,
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
      finalizeStream({ reason: "tool_calls", trigger: usageState.trigger || "backend_error" });
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
    res.write(`: keepalive ${Date.now()}\n\n`);
  };
  const finishSSE = () => {
    if (invokeAdapter("onDone") === true) return;
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
    sendChunk({
      choices: [
        {
          index: normalized,
          delta,
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
  const cloneToolCallDelta = (delta) => {
    if (!delta || typeof delta !== "object") return {};
    const cloned = { ...delta };
    if (delta.function && typeof delta.function === "object") {
      cloned.function = { ...delta.function };
    }
    return cloned;
  };

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
  const sanitizedMetadataSummary = { count: 0, keys: new Set(), sources: new Set() };
  logSanitizerToggle({
    enabled: SANITIZE_METADATA,
    trigger: "request",
    route: "/v1/chat/completions",
    mode: "chat_stream",
    reqId,
  });
  const seenSanitizedRemovalSignatures = new Set();
  const mergedMetadata = { metadata: {}, sources: new Set() };
  const metadataKeyRegister = new Set(metadataKeys());

  const mergeMetadataInfo = (info) => {
    if (!info || typeof info !== "object") {
      const hasMetadata = Object.keys(mergedMetadata.metadata).length > 0;
      const hasSources = mergedMetadata.sources.size > 0;
      if (!hasMetadata && !hasSources) return null;
      return {
        metadata: { ...mergedMetadata.metadata },
        sources: Array.from(mergedMetadata.sources),
      };
    }
    const incomingMetadata =
      info.metadata && typeof info.metadata === "object" ? info.metadata : {};
    for (const [rawKey, rawValue] of Object.entries(incomingMetadata)) {
      const normalized = normalizeMetadataKey(rawKey);
      if (!normalized) continue;
      // Keys derive from deterministic sanitizer allowlist.
      // eslint-disable-next-line security/detect-object-injection
      mergedMetadata.metadata[normalized] = rawValue;
      metadataKeyRegister.add(normalized);
    }
    if (Array.isArray(info.sources)) {
      for (const source of info.sources) {
        if (typeof source === "string" && source) mergedMetadata.sources.add(source);
      }
    }
    const hasMetadata = Object.keys(mergedMetadata.metadata).length > 0;
    const hasSources = mergedMetadata.sources.size > 0;
    if (!hasMetadata && !hasSources) return null;
    return {
      metadata: { ...mergedMetadata.metadata },
      sources: Array.from(mergedMetadata.sources),
    };
  };

  const getSanitizerSummaryData = () => ({
    count: sanitizedMetadataSummary.count,
    keys: Array.from(sanitizedMetadataSummary.keys),
    sources: Array.from(sanitizedMetadataSummary.sources),
  });

  const shouldHoldPartialLine = (candidate, keys) => {
    if (!candidate) return false;
    const trimmed = candidate.trimStart();
    if (!trimmed) return false;
    const withoutContainers = trimmed.replace(/^[[{]\s*/, "");
    const match = withoutContainers.match(/^['"]?([A-Za-z0-9._-]+)/);
    if (!match) return false;
    const candidateKey = normalizeMetadataKey(match[1]);
    if (!candidateKey) return false;
    const hasSeparator = /[:=]/.test(withoutContainers);
    if (hasSeparator) return keys.has(candidateKey);
    for (const key of keys) {
      if (key.startsWith(candidateKey)) return true;
    }
    return false;
  };

  const drainPendingSanitized = (choiceIndex = 0, { flush = false, metadataInfo = null } = {}) => {
    if (!SANITIZE_METADATA) return;
    const state = getSanitizedContentState(choiceIndex);
    if (!state.pending) return;
    const info = metadataInfo || mergeMetadataInfo(null);
    const emitPortion = (portion) => {
      if (!portion) return;
      const sanitizedPortion = applyMetadataSanitizer(portion, info, state.lastContext);
      if (sanitizedPortion) {
        appendContentSegment(sanitizedPortion, { choiceIndex });
      } else if (portion.trim()) {
        scheduleStopAfterTools(choiceIndex);
      }
    };
    while (state.pending) {
      if (!flush) {
        const newlineIdx = state.pending.indexOf("\n");
        if (newlineIdx >= 0) {
          const portion = state.pending.slice(0, newlineIdx + 1);
          state.pending = state.pending.slice(newlineIdx + 1);
          emitPortion(portion);
          continue;
        }
        if (shouldHoldPartialLine(state.pending, metadataKeyRegister)) break;
      }
      const portion = state.pending;
      state.pending = "";
      emitPortion(portion);
      if (!flush) break;
    }
  };

  const enqueueSanitizedSegment = (
    segment,
    metadataInfo,
    context = {},
    { flush = false, choiceIndex = 0 } = {}
  ) => {
    if (!SANITIZE_METADATA) {
      if (segment) appendContentSegment(segment, { choiceIndex });
      return;
    }
    const state = getSanitizedContentState(choiceIndex);
    if (context.stage || context.eventType) {
      state.lastContext = {
        stage: context.stage || state.lastContext.stage,
        eventType: context.eventType || state.lastContext.eventType,
      };
    }
    const mergedInfo = mergeMetadataInfo(metadataInfo);
    if (segment) state.pending += segment;
    drainPendingSanitized(choiceIndex, { flush, metadataInfo: mergedInfo });
  };

  const flushSanitizedSegments = (context = {}) => {
    if (!SANITIZE_METADATA) return;
    const targets =
      typeof context.choiceIndex === "number"
        ? [context.choiceIndex]
        : sanitizedContentStates.size
          ? Array.from(sanitizedContentStates.keys())
          : [0];
    targets.forEach((idx) => {
      const state = getSanitizedContentState(idx);
      if (context.stage || context.eventType) {
        state.lastContext = {
          stage: context.stage || state.lastContext.stage,
          eventType: context.eventType || state.lastContext.eventType,
        };
      }
      drainPendingSanitized(idx, { flush: true });
    });
  };

  const recordSanitizedMetadata = ({ stage, eventType, metadata, removed, sources }) => {
    if (!SANITIZE_METADATA) return;
    const metadataObject =
      metadata && typeof metadata === "object" && Object.keys(metadata).length ? metadata : null;
    const removedEntries = Array.isArray(removed)
      ? removed.filter((entry) => entry && typeof entry === "object")
      : [];
    if (metadataObject) {
      for (const key of Object.keys(metadataObject)) {
        const normalizedKey = normalizeMetadataKey(key);
        if (normalizedKey) {
          sanitizedMetadataSummary.keys.add(normalizedKey);
          metadataKeyRegister.add(normalizedKey);
        }
      }
    }
    const uniqueRemovedEntries = [];
    if (removedEntries.length) {
      for (const entry of removedEntries) {
        const normalizedKey = normalizeMetadataKey(entry.key);
        const signature = `${normalizedKey || ""}::${entry.raw || ""}`;
        if (!signature.trim()) continue;
        if (seenSanitizedRemovalSignatures.has(signature)) continue;
        seenSanitizedRemovalSignatures.add(signature);
        if (normalizedKey) {
          sanitizedMetadataSummary.keys.add(normalizedKey);
          metadataKeyRegister.add(normalizedKey);
        }
        uniqueRemovedEntries.push({ ...entry, key: normalizedKey || entry.key });
      }
      sanitizedMetadataSummary.count += uniqueRemovedEntries.length;
    }
    const sourceList = Array.isArray(sources)
      ? sources.filter((source) => typeof source === "string" && source)
      : [];
    for (const source of sourceList) sanitizedMetadataSummary.sources.add(source);
    if (!metadataObject && !uniqueRemovedEntries.length) return;
    appendProtoEvent({
      ts: Date.now(),
      req_id: reqId,
      route: "/v1/chat/completions",
      mode: "chat_stream",
      kind: "metadata_sanitizer",
      toggle_enabled: true,
      stage,
      event_type: eventType,
      metadata: metadataObject || undefined,
      removed_lines: uniqueRemovedEntries.length ? uniqueRemovedEntries : undefined,
      metadata_sources: sourceList.length ? sourceList : undefined,
    });
  };

  const applyMetadataSanitizer = (segment, metadataInfo, { stage, eventType }) => {
    if (!SANITIZE_METADATA) return segment;
    const metadata = metadataInfo?.metadata || {};
    const { text: sanitizedText, removed } = sanitizeMetadataTextSegment(segment ?? "", metadata);
    if (metadataInfo || (removed && removed.length)) {
      recordSanitizedMetadata({
        stage,
        eventType,
        metadata: metadataInfo ? metadata : null,
        removed,
        sources: metadataInfo?.sources,
      });
    }
    return sanitizedText;
  };
  const usageState = {
    prompt: 0,
    completion: 0,
    emitted: false,
    logged: false,
    trigger: null,
    countsSource: "estimate",
    providerSupplied: false,
    firstTokenMs: null,
    totalDurationMs: null,
  };
  let streamIdleTimer;
  const resetStreamIdle = () => {
    if (streamIdleTimer) clearTimeout(streamIdleTimer);
    streamIdleTimer = setTimeout(() => {
      if (!finalized) trackFinishReason("length", "stream_idle_timeout");
      try {
        child.kill("SIGTERM");
      } catch {}
    }, STREAM_IDLE_TIMEOUT_MS);
  };
  resetStreamIdle();

  const updateUsageCounts = (trigger, { prompt, completion } = {}, { provider = false } = {}) => {
    const promptNum = Number.isFinite(prompt) ? Number(prompt) : NaN;
    const completionNum = Number.isFinite(completion) ? Number(completion) : NaN;
    let touched = false;
    if (!Number.isNaN(promptNum) && promptNum >= 0) {
      usageState.prompt = provider ? promptNum : Math.max(usageState.prompt, promptNum);
      touched = true;
    }
    if (!Number.isNaN(completionNum) && completionNum >= 0) {
      usageState.completion = provider
        ? completionNum
        : Math.max(usageState.completion, completionNum);
      touched = true;
    }
    if (touched) usageState.countsSource = "event";
    if (!usageState.trigger) usageState.trigger = trigger;
    if (provider) usageState.providerSupplied = true;
  };

  const resolvedCounts = () => {
    const emittedLength = Array.from(choiceStates.values()).reduce(
      (sum, state) => sum + state.emitted.length,
      0
    );
    const estimatedCompletion = Math.ceil(emittedLength / 4);
    const usingEvent = usageState.countsSource === "event";
    const promptTokens = usingEvent ? usageState.prompt : promptTokensEst;
    const completionTokens = usingEvent ? usageState.completion : estimatedCompletion;
    const totalTokens = promptTokens + completionTokens;
    return { promptTokens, completionTokens, totalTokens, estimatedCompletion };
  };

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

  const flushActiveToolBuffer = (state, choiceIndex, reason = "abort") => {
    if (!isObsidianOutput) return false;
    if (!state?.toolBuffer?.active) return false;
    const { literal } = abortToolBuffer(state.toolBuffer, state.emitted);
    toolBufferMetrics.abort({ output_mode: outputMode, reason });
    logToolBufferWarning(reason, { choice_index: choiceIndex });
    if (!literal) return false;
    const emitted = emitToolContentChunk(literal, { source: "textual", choiceIndex });
    if (emitted) {
      state.textualToolContentSeen = true;
      state.sentAny = true;
      state.forwardedUpTo = state.emitted.length;
      state.scanPos = state.emitted.length;
      state.dropAssistantContentAfterTools = true;
    }
    return emitted;
  };

  const flushDanglingToolBuffers = (reason = "finalize") => {
    if (!isObsidianOutput) return;
    choiceStates.forEach((state, idx) => {
      flushActiveToolBuffer(state, idx, reason);
    });
  };

  const appendContentSegment = (text, { choiceIndex = 0 } = {}) => {
    const state = ensureChoiceState(choiceIndex);
    if (state.dropAssistantContentAfterTools) {
      scheduleStopAfterTools(choiceIndex);
      return;
    }
    if (!text) return;
    let appendText = text;
    if (state.emitted) {
      if (appendText.startsWith(state.emitted)) {
        appendText = appendText.slice(state.emitted.length);
      } else {
        const maxOverlap = Math.min(state.emitted.length, appendText.length);
        let overlap = 0;
        for (let i = maxOverlap; i > 0; i -= 1) {
          if (state.emitted.slice(state.emitted.length - i) === appendText.slice(0, i)) {
            overlap = i;
            break;
          }
        }
        appendText = appendText.slice(overlap);
        if (!appendText && state.emitted.includes(text)) {
          appendText = "";
        }
      }
    }
    if (!appendText) {
      scheduleStopAfterTools(choiceIndex);
      return;
    }
    state.emitted += appendText;
    if (isObsidianOutput) {
      const startedAt = trackToolBufferOpen(state.toolBuffer, state.emitted, state.forwardedUpTo);
      if (startedAt >= 0) {
        toolBufferMetrics.start({ output_mode: outputMode });
      }
      const nestedAt = detectNestedToolBuffer(state.toolBuffer, state.emitted);
      if (nestedAt >= 0) {
        flushActiveToolBuffer(state, choiceIndex, "nested_open");
      }
    }
    try {
      const { blocks, nextPos } = extractUseToolBlocks(state.emitted, state.scanPos);
      if (blocks && blocks.length) {
        textualToolCount += blocks.length;
        state.hasToolEvidence = true;
        state.lastToolEnd = blocks[blocks.length - 1].end;
        state.scanPos = nextPos;
        for (const block of blocks) {
          if (block.end <= state.forwardedUpTo) continue;
          if (shouldSkipBlock(state.toolBuffer, block.end)) continue;
          const literal = state.emitted.slice(block.start, block.end);
          if (!literal) continue;
          if (isObsidianOutput) {
            if (emitToolContentChunk(literal, { source: "textual", choiceIndex })) {
              state.forwardedUpTo = block.end;
              completeToolBuffer(state.toolBuffer, block.end);
              toolBufferMetrics.flush({ output_mode: outputMode });
              continue;
            }
          } else {
            state.forwardedUpTo = block.end;
            state.dropAssistantContentAfterTools = true;
            break;
          }
        }
      }
    } catch {}
    const limitTail = SUPPRESS_TAIL_AFTER_TOOLS || STOP_AFTER_TOOLS;
    const allowUntil = clampEmittableIndex(
      state.toolBuffer,
      state.forwardedUpTo,
      state.emitted.length,
      state.lastToolEnd,
      limitTail
    );
    const segment = state.emitted.slice(state.forwardedUpTo, allowUntil);
    if (segment) {
      sendChoiceDelta(choiceIndex, { content: segment });
      state.sentAny = true;
      state.forwardedUpTo = allowUntil;
    }
    scheduleStopAfterTools(choiceIndex);
  };

  const emitToolContentChunk = (content, { source = "aggregator", choiceIndex = 0 } = {}) => {
    if (!isObsidianOutput) return false;
    const state = ensureChoiceState(choiceIndex);
    if (source === "aggregator" && state.textualToolContentSeen) return false;
    const text = typeof content === "string" ? content : "";
    if (!text) return false;
    emitTextualToolMetadata(choiceIndex, text);
    state.dropAssistantContentAfterTools = true;
    state.hasToolEvidence = true;
    sendChoiceDelta(choiceIndex, { content: text });
    state.sentAny = true;
    state.forwardedToolCount = Math.max(0, (state.forwardedToolCount || 0) + 1);
    if (source === "textual") state.textualToolContentSeen = true;
    scheduleStopAfterTools(choiceIndex);
    return true;
  };

  const shouldDropFunctionCallOutput = (payload = null) => {
    if (!payload || typeof payload !== "object") return false;
    const outputField = payload.output;
    return typeof outputField === "string" && outputField.includes("resources/list failed");
  };

  const buildObsidianXmlRecord = (record = null) => {
    if (!record) return null;
    const args = record?.function?.arguments || "";
    if (!args) return null;
    try {
      JSON.parse(args);
    } catch {
      return null;
    }
    return toObsidianXml(record);
  };

  const emitAggregatorToolContent = (choiceIndex = 0, snapshot = null) => {
    if (!isObsidianOutput) return false;
    const state = ensureChoiceState(choiceIndex);
    if (state.textualToolContentSeen) {
      const size = Array.isArray(snapshot)
        ? snapshot.length
        : toolCallAggregator.snapshot({ choiceIndex }).length;
      state.forwardedToolCount = Math.max(state.forwardedToolCount || 0, size);
      return false;
    }
    try {
      const records = Array.isArray(snapshot)
        ? snapshot
        : toolCallAggregator.snapshot({ choiceIndex });
      let emitted = false;
      while (state.forwardedToolCount < records.length) {
        const ordinal = state.forwardedToolCount;
        // eslint-disable-next-line security/detect-object-injection -- ordinal indexes sequential tool calls
        const xml = buildObsidianXmlRecord(records[ordinal]);
        if (!xml) break;
        if (!emitToolContentChunk(xml, { source: "aggregator", choiceIndex })) break;
        emitted = true;
      }
      if (!emitted && state.forwardedToolCount > records.length) {
        state.forwardedToolCount = records.length;
      }
      return emitted;
    } catch (err) {
      try {
        console.error("[proxy][chat.stream] failed to build obsidian XML", err);
      } catch {}
      return false;
    }
  };

  const emitUsageChunk = (trigger) => {
    if (usageState.emitted || !includeUsage) return;
    const { promptTokens, completionTokens } = resolvedCounts();
    const aggregatedCompletion = completionTokens * choiceCount;
    const aggregatedTotal = promptTokens + aggregatedCompletion;
    const firstTokenMs = firstTokenAt === null ? null : Math.max(firstTokenAt - started, 0);
    const totalDurationMs = Math.max(Date.now() - started, 0);
    usageState.firstTokenMs = firstTokenMs;
    usageState.totalDurationMs = totalDurationMs;
    usageState.emitted = true;
    sendChunk({
      choices: [],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: aggregatedCompletion,
        total_tokens: aggregatedTotal,
        time_to_first_token_ms: firstTokenMs,
        total_duration_ms: totalDurationMs,
        // Story 2.6 placeholders remain
        time_to_first_token: null,
        throughput_after_first_token: null,
        emission_trigger: trigger,
      },
    });
  };

  const logUsage = (trigger) => {
    if (usageState.logged) return;
    const { promptTokens, completionTokens, estimatedCompletion } = resolvedCounts();
    const aggregatedCompletion = completionTokens * choiceCount;
    const aggregatedTotal = promptTokens + aggregatedCompletion;
    const aggregatedEstCompletion = estimatedCompletion * choiceCount;
    const emittedAtMs = Date.now() - started;
    const firstTokenMs =
      usageState.firstTokenMs !== null
        ? usageState.firstTokenMs
        : firstTokenAt === null
          ? null
          : Math.max(firstTokenAt - started, 0);
    const totalDurationMs = usageState.totalDurationMs ?? emittedAtMs;
    const resolved = finalFinishReason
      ? { reason: finalFinishReason, source: finalFinishSource }
      : resolveFinishReason();
    const {
      count: sanitizedMetadataCount,
      keys: sanitizedMetadataKeys,
      sources: sanitizedMetadataSources,
    } = getSanitizerSummaryData();
    if (SANITIZE_METADATA) {
      logSanitizerSummary({
        enabled: true,
        route: "/v1/chat/completions",
        mode: "chat_stream",
        reqId,
        count: sanitizedMetadataCount,
        keys: sanitizedMetadataKeys,
        sources: sanitizedMetadataSources,
      });
    }
    try {
      const httpCtx = getHttpContext(res);
      appendUsage({
        req_id: reqId,
        route: httpCtx.route || "/v1/chat/completions",
        mode: httpCtx.mode || "chat_stream",
        method: req.method || "POST",
        status_code: 200,
        requested_model: requestedModel,
        effective_model: effectiveModel,
        stream: true,
        prompt_tokens: promptTokens,
        completion_tokens: aggregatedCompletion,
        total_tokens: aggregatedTotal,
        prompt_tokens_est: promptTokensEst,
        completion_tokens_est: aggregatedEstCompletion,
        total_tokens_est: promptTokensEst + aggregatedEstCompletion,
        duration_ms: emittedAtMs,
        total_duration_ms: totalDurationMs,
        status: 200,
        user_agent: req.headers["user-agent"] || "",
        emission_trigger: trigger,
        emitted_at_ms: emittedAtMs,
        counts_source: usageState.countsSource,
        usage_included: includeUsage,
        provider_supplied: usageState.providerSupplied,
        time_to_first_token_ms: firstTokenMs,
        finish_reason: resolved.reason,
        finish_reason_source: resolved.source,
        has_tool_calls: hasToolCallEvidence(),
        has_function_call: hasFunctionCall,
        tool_call_parallel_supported: toolCallAggregator.supportsParallelCalls(),
        tool_call_emitted: toolCallAggregator.hasCalls(),
        tool_call_count_total: lastToolStats.count,
        tool_call_truncated_total: lastToolStats.truncated,
        stop_after_tools_mode: STOP_AFTER_TOOLS_MODE || "burst",
        choice_count: choiceCount,
        metadata_sanitizer_enabled: SANITIZE_METADATA,
        sanitized_metadata_count: SANITIZE_METADATA ? sanitizedMetadataCount : 0,
        sanitized_metadata_keys: SANITIZE_METADATA ? sanitizedMetadataKeys : [],
        sanitized_metadata_sources: SANITIZE_METADATA ? sanitizedMetadataSources : [],
        output_mode: outputMode,
      });
    } catch (e) {
      if (IS_DEV_ENV) console.error("[dev][response][chat][stream] usage log error:", e);
    }
    usageState.logged = true;
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
      usageState.trigger ||
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
    if (!usageState.emitted && includeUsage) emitUsageChunk(resolvedTrigger);
    if (!finishSent) emitFinishChunk();
    if (!usageState.logged) logUsage(resolvedTrigger);
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
    if (SANITIZE_METADATA) {
      const {
        count: sanitizedMetadataCount,
        keys: sanitizedMetadataKeys,
        sources: sanitizedMetadataSources,
      } = getSanitizerSummaryData();
      appendProtoEvent({
        ts: Date.now(),
        req_id: reqId,
        route: "/v1/chat/completions",
        mode: "chat_stream",
        kind: "metadata_sanitizer_summary",
        sanitized_count: sanitizedMetadataCount,
        sanitized_keys: sanitizedMetadataKeys,
        sanitized_sources: sanitizedMetadataSources,
      });
    }
    const outcome = resolvedFinish.reason || "ok";
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

  child.stdout.on("data", (chunk) => {
    if (finalized) return;
    resetStreamIdle();
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
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const evt = JSON.parse(trimmed);
        const rawType = (evt && (evt.msg?.type || evt.type)) || "";
        const t = typeof rawType === "string" ? rawType.replace(/^codex\/event\//i, "") : "";
        appendProtoEvent({
          ts: Date.now(),
          req_id: reqId,
          route: "/v1/chat/completions",
          mode: "chat_stream",
          kind: "event",
          event: evt,
        });
        const payload = evt && typeof evt === "object" ? evt : {};
        const params = payload.msg && typeof payload.msg === "object" ? payload.msg : payload;
        const messagePayload = params.msg && typeof params.msg === "object" ? params.msg : params;
        const metadataInfo = SANITIZE_METADATA ? extractMetadataFromPayload(params) : null;
        const baseChoiceIndex = resolveChoiceIndexFromPayload(params, messagePayload);
        if (messagePayload) {
          trackToolSignals(messagePayload);
          const finishCandidate = extractFinishReasonFromMessage(messagePayload);
          if (finishCandidate) trackFinishReason(finishCandidate, t || "event");
        }
        if (t === "agent_message_content_delta" || t === "agent_message_delta") {
          const deltaPayload = messagePayload?.delta ?? messagePayload;
          const choiceIndex =
            resolveChoiceIndexFromPayload(deltaPayload, messagePayload, params) ??
            baseChoiceIndex ??
            0;
          if (typeof deltaPayload === "string") {
            if (SANITIZE_METADATA) {
              enqueueSanitizedSegment(
                deltaPayload,
                metadataInfo,
                {
                  stage: "agent_message_delta",
                  eventType: t,
                },
                { choiceIndex }
              );
            } else if (deltaPayload) {
              appendContentSegment(deltaPayload, { choiceIndex });
            }
          } else if (deltaPayload && typeof deltaPayload === "object") {
            const { deltas, updated } = toolCallAggregator.ingestDelta(deltaPayload, {
              choiceIndex,
            });
            if (updated) {
              hasToolCallsFlag = true;
              const state = ensureChoiceState(choiceIndex);
              state.hasToolEvidence = true;
              if (!isObsidianOutput) state.dropAssistantContentAfterTools = true;
              const snapshot = toolCallAggregator.snapshot({ choiceIndex });
              state.structuredCount = snapshot.length;
              for (const toolDelta of deltas) {
                if (LOG_PROTO) {
                  appendProtoEvent({
                    ts: Date.now(),
                    req_id: reqId,
                    route: "/v1/chat/completions",
                    mode: "chat_stream",
                    kind: "tool_call_delta",
                    event: toolDelta,
                  });
                }
                state.hasToolEvidence = true;
                sendChoiceDelta(choiceIndex, {
                  tool_calls: [cloneToolCallDelta(toolDelta)],
                });
              }
              if (!isObsidianOutput || state.textualToolContentSeen) {
                state.forwardedToolCount = snapshot.length;
              } else {
                emitAggregatorToolContent(choiceIndex, snapshot);
              }
            }
            const textDelta = coerceAssistantContent(
              deltaPayload.content ?? deltaPayload.text ?? ""
            );
            if (SANITIZE_METADATA) {
              enqueueSanitizedSegment(
                textDelta,
                metadataInfo,
                {
                  stage: "agent_message_delta",
                  eventType: t,
                },
                { choiceIndex }
              );
            } else if (textDelta) {
              appendContentSegment(textDelta, { choiceIndex });
            }
          }
        } else if (t === "agent_message") {
          const finalMessage = messagePayload?.message ?? messagePayload;
          const choiceIndex =
            resolveChoiceIndexFromPayload(finalMessage, messagePayload, params) ??
            baseChoiceIndex ??
            0;
          if (typeof finalMessage === "string") {
            const rawMessage = finalMessage;
            if (rawMessage) {
              if (emitTextualToolMetadata(choiceIndex, rawMessage)) {
                const state = ensureChoiceState(choiceIndex);
                state.hasToolEvidence = true;
              }
              let aggregatedInfo = null;
              if (SANITIZE_METADATA) {
                enqueueSanitizedSegment(
                  "",
                  metadataInfo,
                  {
                    stage: "agent_message",
                    eventType: t,
                  },
                  { flush: true, choiceIndex }
                );
                aggregatedInfo = mergeMetadataInfo(null);
              }
              const sanitizedMessage = SANITIZE_METADATA
                ? applyMetadataSanitizer(rawMessage, aggregatedInfo, {
                    stage: "agent_message",
                    eventType: t,
                  })
                : rawMessage;
              if (sanitizedMessage) {
                let suffix = "";
                const state = ensureChoiceState(choiceIndex);
                if (sanitizedMessage.startsWith(state.emitted)) {
                  suffix = sanitizedMessage.slice(state.emitted.length);
                } else if (!state.sentAny) {
                  suffix = sanitizedMessage;
                }
                if (suffix) appendContentSegment(suffix, { choiceIndex });
                else if (SANITIZE_METADATA) scheduleStopAfterTools(choiceIndex);
              } else if (SANITIZE_METADATA) {
                scheduleStopAfterTools(choiceIndex);
              }
            }
          } else if (finalMessage && typeof finalMessage === "object") {
            const { deltas, updated } = toolCallAggregator.ingestMessage(finalMessage, {
              emitIfMissing: true,
              choiceIndex,
            });
            const state = ensureChoiceState(choiceIndex);
            if (updated) {
              hasToolCallsFlag = true;
              state.hasToolEvidence = true;
              if (!isObsidianOutput) state.dropAssistantContentAfterTools = true;
              for (const toolDelta of deltas) {
                if (LOG_PROTO) {
                  appendProtoEvent({
                    ts: Date.now(),
                    req_id: reqId,
                    route: "/v1/chat/completions",
                    mode: "chat_stream",
                    kind: "tool_call_delta",
                    event: toolDelta,
                    source: "agent_message",
                  });
                }
                sendChoiceDelta(choiceIndex, {
                  tool_calls: [cloneToolCallDelta(toolDelta)],
                });
              }
            }
            if (toolCallAggregator.hasCalls()) hasToolCallsFlag = true;
            const snapshot = toolCallAggregator.snapshot({ choiceIndex });
            state.structuredCount = snapshot.length;
            if (!isObsidianOutput || state.textualToolContentSeen) {
              state.forwardedToolCount = snapshot.length;
            } else {
              emitAggregatorToolContent(choiceIndex, snapshot);
            }
            const text = coerceAssistantContent(finalMessage.content ?? finalMessage.text ?? "");
            let aggregatedInfo = null;
            if (SANITIZE_METADATA) {
              enqueueSanitizedSegment(
                "",
                metadataInfo,
                {
                  stage: "agent_message",
                  eventType: t,
                },
                { flush: true, choiceIndex }
              );
              aggregatedInfo = mergeMetadataInfo(null);
            }
            const sanitizedText = SANITIZE_METADATA
              ? applyMetadataSanitizer(text, aggregatedInfo, {
                  stage: "agent_message",
                  eventType: t,
                })
              : text;
            if (sanitizedText) {
              let suffix = "";
              const state = ensureChoiceState(choiceIndex);
              if (sanitizedText.startsWith(state.emitted)) {
                suffix = sanitizedText.slice(state.emitted.length);
              } else if (!state.sentAny) {
                suffix = sanitizedText;
              }
              if (suffix) appendContentSegment(suffix, { choiceIndex });
              else if (SANITIZE_METADATA) scheduleStopAfterTools(choiceIndex);
            } else {
              scheduleStopAfterTools(choiceIndex);
            }
          }
        } else if (t === "function_call_output") {
          if (shouldDropFunctionCallOutput(messagePayload)) {
            continue;
          }
        } else if (t === "metadata") {
          if (SANITIZE_METADATA && metadataInfo) {
            mergeMetadataInfo(metadataInfo);
            recordSanitizedMetadata({
              stage: "metadata_event",
              eventType: t,
              metadata: metadataInfo.metadata,
              removed: [],
              sources: metadataInfo.sources,
            });
          }
        } else if (t === "token_count") {
          const promptTokens = Number(
            messagePayload?.prompt_tokens ??
              messagePayload?.promptTokens ??
              messagePayload?.token_count?.prompt_tokens ??
              params?.prompt_tokens ??
              params?.promptTokens ??
              params?.token_count?.prompt_tokens
          );
          const completionTokens = Number(
            messagePayload?.completion_tokens ??
              messagePayload?.completionTokens ??
              messagePayload?.token_count?.completion_tokens ??
              params?.completion_tokens ??
              params?.completionTokens ??
              params?.token_count?.completion_tokens
          );
          updateUsageCounts("token_count", { prompt: promptTokens, completion: completionTokens });
          const tokenFinishReason = extractFinishReasonFromMessage(messagePayload);
          if (tokenFinishReason) trackFinishReason(tokenFinishReason, "token_count");
        } else if (t === "usage") {
          const promptTokens = Number(
            messagePayload?.prompt_tokens ??
              messagePayload?.usage?.prompt_tokens ??
              params?.usage?.prompt_tokens ??
              params?.prompt_tokens ??
              params?.promptTokens ??
              params?.token_count?.prompt_tokens
          );
          const completionTokens = Number(
            messagePayload?.completion_tokens ??
              messagePayload?.usage?.completion_tokens ??
              params?.usage?.completion_tokens ??
              params?.completion_tokens ??
              params?.completionTokens ??
              params?.token_count?.completion_tokens
          );
          updateUsageCounts(
            "provider",
            { prompt: promptTokens, completion: completionTokens },
            { provider: true }
          );
        } else if (t === "task_complete") {
          const finishReason = extractFinishReasonFromMessage(messagePayload);
          if (finishReason) trackFinishReason(finishReason, "task_complete");
          else if (!Array.from(choiceStates.values()).some((state) => state.sentAny))
            trackFinishReason("length", "task_complete");
          else if (lengthEvidence) trackFinishReason("length", "task_complete");
          const promptTokens = Number(
            messagePayload?.prompt_tokens ??
              messagePayload?.token_count?.prompt_tokens ??
              params?.token_count?.prompt_tokens ??
              params?.prompt_tokens ??
              params?.promptTokens
          );
          const completionTokens = Number(
            messagePayload?.completion_tokens ??
              messagePayload?.token_count?.completion_tokens ??
              params?.token_count?.completion_tokens ??
              params?.completion_tokens ??
              params?.completionTokens
          );
          if (Number.isFinite(promptTokens) || Number.isFinite(completionTokens)) {
            updateUsageCounts(usageState.trigger || "task_complete", {
              prompt: promptTokens,
              completion: completionTokens,
            });
          } else if (!usageState.trigger) {
            usageState.trigger = "task_complete";
          }
          emitFinishChunk(finishReason || undefined);
          finalizeStream({ reason: finishReason, trigger: usageState.trigger || "task_complete" });
          return;
        } else if (t === "error") {
          if (DEBUG_PROTO)
            try {
              console.log("[proto] error event");
            } catch {}
        }
      } catch {
        if (DEBUG_PROTO)
          try {
            console.log("[proto] parse error line:", trimmed);
          } catch {}
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
    if (!finishSent && usageState.trigger === "token_count" && !lengthEvidence) {
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
    const trigger = usageState.trigger || (includeUsage ? "token_count" : "close");
    const inferredReason = finishSent ? finalFinishReason : lengthEvidence ? "length" : "stop";
    finalizeStream({ reason: inferredReason, trigger });
  };
  child.on("close", handleChildClose);
  child.on?.("exit", handleChildClose);
}

// POST /v1/completions with stream=true (legacy shim that maps to proto)
export async function postCompletionsStream(req, res) {
  try {
    console.log("[completions] POST /v1/completions received");
  } catch {}
  setHttpContext(res, { route: "/v1/completions", mode: "completions_stream" });
  const reqId = ensureReqId(res);
  const started = Date.now();
  let responded = false;
  let responseWritable = true;

  const body = req.body || {};
  logHttpRequest({
    req,
    res,
    route: "/v1/completions",
    mode: "completions_stream",
    body,
  });

  const model = requireModel({
    req,
    res,
    body,
    reqId,
    started,
    route: "/v1/completions",
    mode: "completions_stream",
    logUsageFailure,
    applyCors,
    sendJson: (statusCode, payload) => res.status(statusCode).json(payload),
  });
  if (!model) return;

  // Concurrency guard for legacy completions stream as well
  const MAX_CONC = Number(CFG.PROXY_SSE_MAX_CONCURRENCY || 0) || 0;

  const prompt = Array.isArray(body.prompt) ? body.prompt.join("\n") : body.prompt || "";
  if (IS_DEV_ENV) {
    try {
      console.log("[dev][prompt][completions] prompt=\n" + prompt);
      appendProtoEvent({
        ts: Date.now(),
        req_id: reqId,
        route: "/v1/completions",
        mode: "completions",
        kind: "submission",
        payload: { prompt },
      });
    } catch (e) {
      console.error("[dev][prompt][completions] error:", e);
    }
  }
  if (!prompt) {
    logUsageFailure({
      req,
      res,
      reqId,
      started,
      route: "/v1/completions",
      mode: "completions_stream",
      statusCode: 400,
      reason: "invalid_request",
      errorCode: "prompt_required",
    });
    applyCors(req, res);
    return res.status(400).json({
      error: {
        message: "prompt required",
        type: "invalid_request_error",
        param: "prompt",
        code: "invalid_request_error",
      },
    });
  }

  const { requested: requestedModel, effective: effectiveModel } = normalizeModel(
    model,
    DEFAULT_MODEL,
    Array.from(ACCEPTED_MODEL_IDS)
  );
  try {
    console.log(
      `[proxy] completions model requested=${requestedModel} effective=${effectiveModel} stream=${!!body.stream}`
    );
  } catch {}
  if (!ACCEPTED_MODEL_IDS.has(requestedModel)) {
    logUsageFailure({
      req,
      res,
      reqId,
      started,
      route: "/v1/completions",
      mode: "completions_stream",
      statusCode: 404,
      reason: "model_not_found",
      errorCode: "model_not_found",
      requestedModel,
    });
    applyCors(req, res);
    return res.status(404).json(modelNotFoundBody(requestedModel));
  }

  let reasoningEffort = (
    body.reasoning?.effort ||
    body.reasoning_effort ||
    body.reasoningEffort ||
    ""
  )
    .toString()
    .toLowerCase();
  const allowEffort = new Set(["low", "medium", "high", "xhigh", "minimal"]);
  if (!reasoningEffort) {
    const implied = impliedEffortForModel(requestedModel);
    if (implied) reasoningEffort = implied;
  }

  const backendMode = selectBackendMode();
  const args = buildBackendArgs({
    backendMode,
    SANDBOX_MODE,
    effectiveModel,
    FORCE_PROVIDER,
    reasoningEffort,
    allowEffort,
    enableParallelTools: ENABLE_PARALLEL_TOOL_CALLS,
  });

  const messages = [{ role: "user", content: prompt }];
  const toSend = joinMessages(messages);
  const promptTokensEst = estTokensForMessages(messages);

  try {
    console.log(
      `[proxy] spawning backend=${backendMode} (completions):`,
      resolvedCodexBin,
      args.join(" "),
      " prompt_len=",
      toSend.length
    );
  } catch {}

  const guardContext = setupStreamGuard({
    res,
    reqId,
    route: "/v1/completions",
    maxConc: MAX_CONC,
    testEndpointsEnabled: TEST_ENDPOINTS_ENABLED,
    send429: () => {
      applyCors(req, res);
      logUsageFailure({
        req,
        res,
        reqId,
        started,
        route: "/v1/completions",
        mode: "completions_stream",
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

  const completionsTrace = { reqId, route: "/v1/completions", mode: "completions_stream" };
  let normalizedRequest = null;
  if (backendMode === BACKEND_APP_SERVER) {
    try {
      normalizedRequest = normalizeChatJsonRpcRequest({
        body,
        messages,
        prompt: toSend,
        effectiveModel,
        choiceCount: 1,
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
          route: "/v1/completions",
          mode: "completions_stream",
          statusCode: err.statusCode || 400,
          reason: "normalization_error",
          errorCode: err.body?.error?.code || err.code,
          requestedModel,
          effectiveModel,
        });
        applyCors(req, res);
        return res.status(err.statusCode).json(err.body);
      }
      throw err;
    }
  }
  const child =
    backendMode === BACKEND_APP_SERVER
      ? createJsonRpcChildAdapter({
          reqId,
          timeoutMs: REQ_TIMEOUT_MS,
          normalizedRequest,
          trace: completionsTrace,
        })
      : spawnCodex(args, {
          reqId,
          route: completionsTrace.route,
          mode: completionsTrace.mode,
        });
  const onChildError = (error) => {
    try {
      console.log("[proxy] child error (completions):", error?.message || String(error));
    } catch {}
    if (responded) return;
    markCompletionsResponded();
    try {
      clearTimeout(timeout);
    } catch {}
    const mapped = mapTransportError(error);
    try {
      if (mapped) {
        sendSSEUtil(res, mapped.body);
      } else {
        sendSSEUtil(res, sseErrorBody(error));
      }
    } catch {}
    logUsageFailure({
      req,
      res,
      reqId,
      started,
      route: "/v1/completions",
      mode: "completions_stream",
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
  };
  child.on("error", onChildError);

  const timeout = setTimeout(() => {
    if (responded) return;
    onChildError(new Error("request timeout"));
    try {
      child.kill("SIGKILL");
    } catch {}
  }, REQ_TIMEOUT_MS);

  let idleTimerCompletions;
  function cancelIdleCompletions() {
    if (idleTimerCompletions) {
      clearTimeout(idleTimerCompletions);
      idleTimerCompletions = null;
    }
  }
  const resetIdleCompletions = () => {
    cancelIdleCompletions();
    idleTimerCompletions = setTimeout(() => {
      idleTimerCompletions = null;
      if (responded) return;
      try {
        console.log("[proxy] completions idle timeout; terminating child");
      } catch {}
      try {
        res.write(
          `data: ${JSON.stringify({ error: { message: "backend idle timeout", type: "timeout_error", code: "idle_timeout" } })}\n\n`
        );
      } catch {}
      try {
        res.write("data: [DONE]\n\n");
        res.end();
      } catch {}
      logUsageFailure({
        req,
        res,
        reqId,
        started,
        route: "/v1/completions",
        mode: "completions_stream",
        statusCode: 504,
        reason: "backend_idle_timeout",
        errorCode: "idle_timeout",
        requestedModel,
        effectiveModel,
      });
      markCompletionsResponded();
      try {
        child.kill("SIGTERM");
      } catch {}
    }, STREAM_IDLE_TIMEOUT_MS);
  };
  function markCompletionsResponded() {
    responded = true;
    cancelIdleCompletions();
  }
  resetIdleCompletions();
  req.on("close", () => {
    if (responded) return;
    if (KILL_ON_DISCONNECT) {
      try {
        child.kill("SIGTERM");
      } catch {}
    }
  });

  try {
    const submission = {
      id: reqId,
      op: { type: "user_input", items: [{ type: "text", text: toSend }] },
    };
    child.stdin.write(JSON.stringify(submission) + "\n");
  } catch {}

  let out = "";
  const completionId = `cmpl-${nanoid()}`;
  const created = Math.floor(Date.now() / 1000);
  const sendSSE = (payload) => {
    try {
      if (!responseWritable) return;
      sendSSEUtil(res, payload);
    } catch {}
  };
  const sendChunk = (payload) => {
    sendSSE({
      id: completionId,
      object: "text_completion.chunk",
      created,
      model: requestedModel,
      ...payload,
    });
  };
  const finishSSE = () => {
    try {
      finishSSEUtil(res);
    } catch {}
  };

  setSSEHeaders(res);

  // Keepalives (parity with chat stream)
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
    responseWritable = false;
    try {
      clearTimeout(timeout);
    } catch {}
    try {
      if (KILL_ON_DISCONNECT) child.kill("SIGTERM");
    } catch {}
    releaseGuard();
  };
  if (keepaliveMs > 0)
    keepalive = startKeepalives(res, keepaliveMs, () => {
      try {
        if (!streamClosed) res.write(`: keepalive ${Date.now()}\n\n`);
      } catch {}
    });
  res.on("close", cleanupStream);
  res.on("finish", cleanupStream);
  req.on?.("aborted", cleanupStream);

  let buf = "";
  let sentAny = false;
  let emitted = "";
  let completionChars = 0;
  const toolStateC = { pos: 0, idx: 0 };

  child.stdout.on("data", (d) => {
    resetIdleCompletions();
    const s = d.toString("utf8");
    out += s;
    buf += s;
    if (LOG_PROTO)
      appendProtoEvent({
        ts: Date.now(),
        req_id: reqId,
        route: "/v1/completions",
        mode: "completions_stream",
        kind: "stdout",
        chunk: s,
      });
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      const t = line.trim();
      if (!t) continue;
      try {
        const evt = JSON.parse(t);
        const rawTp = (evt && (evt.msg?.type || evt.type)) || "";
        const tp = typeof rawTp === "string" ? rawTp.replace(/^codex\/event\//i, "") : "";
        const payload = evt && typeof evt === "object" ? evt : {};
        const params = payload.msg && typeof payload.msg === "object" ? payload.msg : payload;
        const messagePayload = params.msg && typeof params.msg === "object" ? params.msg : params;
        appendProtoEvent({
          ts: Date.now(),
          req_id: reqId,
          route: "/v1/completions",
          mode: "completions_stream",
          kind: "event",
          event: evt,
        });
        if (tp === "agent_message_delta") {
          const deltaPayload = messagePayload?.delta ?? messagePayload;
          const dlt =
            typeof deltaPayload === "string"
              ? deltaPayload
              : deltaPayload && typeof deltaPayload === "object"
                ? coerceAssistantContent(
                    deltaPayload.content ?? deltaPayload.text ?? deltaPayload.delta ?? ""
                  )
                : "";
          if (dlt) {
            sentAny = true;
            emitted += dlt;
            completionChars += dlt.length;
            sendChunk({ choices: [{ index: 0, text: dlt }] });
            const { blocks, nextPos } = extractUseToolBlocks(emitted, toolStateC.pos);
            toolStateC.pos = nextPos;
            if (blocks && blocks.length) {
              // emit proto events for tools for debugging
              for (const b of blocks) {
                appendProtoEvent({
                  ts: Date.now(),
                  req_id: reqId,
                  route: "/v1/completions",
                  mode: "completions_stream",
                  kind: "tool_block",
                  idx: ++toolStateC.idx,
                  char_start: b.start,
                  char_end: b.end,
                  tool: b.name,
                  path: b.path,
                  query: b.query,
                });
              }
            }
          }
        } else if (tp === "agent_message") {
          const messageValue = messagePayload?.message ?? messagePayload;
          const m =
            typeof messageValue === "string"
              ? messageValue
              : messageValue && typeof messageValue === "object"
                ? coerceAssistantContent(messageValue.content ?? messageValue.text ?? "")
                : "";
          if (m) {
            let suffix = "";
            if (m.startsWith(emitted)) suffix = m.slice(emitted.length);
            else if (!sentAny) suffix = m;
            if (suffix) {
              sentAny = true;
              emitted += suffix;
              completionChars += suffix.length;
              sendChunk({ choices: [{ index: 0, text: suffix }] });
              const { blocks, nextPos } = extractUseToolBlocks(emitted, toolStateC.pos);
              toolStateC.pos = nextPos;
              for (const b of blocks || []) {
                appendProtoEvent({
                  ts: Date.now(),
                  req_id: reqId,
                  route: "/v1/completions",
                  mode: "completions_stream",
                  kind: "tool_block",
                  idx: ++toolStateC.idx,
                  char_start: b.start,
                  char_end: b.end,
                  tool: b.name,
                  path: b.path,
                  query: b.query,
                });
              }
            }
          }
        } else if (tp === "token_count") {
          // no-op for legacy completions stream; emit in close
        } else if (tp === "task_complete") {
          clearTimeout(timeout);
          if (!sentAny) {
            const content = stripAnsi(out).trim() || "No output from backend.";
            sendChunk({ choices: [{ index: 0, text: content }] });
          }
          if (IS_DEV_ENV && sentAny) {
            try {
              console.log("[dev][response][completions][stream] content=\n" + emitted);
            } catch (e) {
              console.error("[dev][response][completions][stream] error:", e);
            }
          }
          const completion_tokens_est = Math.ceil(completionChars / 4);
          if (LOG_PROTO) {
            try {
              const { blocks } = extractUseToolBlocks(emitted, toolStateC.pos);
              for (const b of blocks || []) {
                appendProtoEvent({
                  ts: Date.now(),
                  req_id: reqId,
                  route: "/v1/completions",
                  mode: "completions_stream",
                  kind: "tool_block",
                  idx: ++toolStateC.idx,
                  char_start: b.start,
                  char_end: b.end,
                  tool: b.name,
                  path: b.path,
                  query: b.query,
                });
              }
            } catch {}
          }
          const completionsCtx = getHttpContext(res);
          appendUsage({
            req_id: reqId,
            route: completionsCtx.route || "/v1/completions",
            mode: completionsCtx.mode || "completions_stream",
            method: req.method || "POST",
            status_code: 200,
            requested_model: requestedModel,
            effective_model: effectiveModel,
            stream: true,
            prompt_tokens_est: promptTokensEst,
            completion_tokens_est,
            total_tokens_est: promptTokensEst + completion_tokens_est,
            duration_ms: Date.now() - started,
            status: 200,
            user_agent: req.headers["user-agent"] || "",
          });
          markCompletionsResponded();
          finishSSE();
          return;
        }
      } catch {}
    }
  });
  child.stderr.on("data", (e) => {
    resetIdleCompletions();
    const s = e.toString("utf8");
    try {
      console.log("[proxy] child stderr:", s.trim());
    } catch {}
    if (LOG_PROTO)
      appendProtoEvent({
        ts: Date.now(),
        req_id: reqId,
        route: "/v1/completions",
        mode: "completions_stream",
        kind: "stderr",
        chunk: s,
      });
  });
  const finalizeOnChildExit = (outcome = "released:child_close") => {
    if (responded) return;
    markCompletionsResponded();
    clearTimeout(timeout);
    cancelIdleCompletions();
    // If not completed via task_complete, still finish stream
    if (!sentAny) {
      const content = stripAnsi(out).trim() || "No output from backend.";
      sendChunk({ choices: [{ index: 0, text: content }] });
    }
    finishSSE();
    releaseGuard(outcome);
  };
  child.on("close", () => finalizeOnChildExit("released:child_close"));
  child.on?.("exit", () => finalizeOnChildExit("released:child_exit"));
  child.stdout.on?.("end", () => finalizeOnChildExit("released:stdout_end"));
}
