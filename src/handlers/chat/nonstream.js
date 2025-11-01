import { spawnCodex, resolvedCodexBin } from "../../services/codex-runner.js";
import { nanoid } from "nanoid";
import {
  stripAnsi,
  estTokens,
  estTokensForMessages,
  joinMessages,
  impliedEffortForModel,
  normalizeModel,
  applyCors as applyCorsUtil,
} from "../../utils.js";
import { config as CFG } from "../../config/index.js";
import { acceptedModelIds } from "../../config/models.js";
import {
  authErrorBody,
  modelNotFoundBody,
  invalidRequestBody,
  tokensExceededBody,
} from "../../lib/errors.js";
import {
  appendUsage,
  appendProtoEvent,
  extractUseToolBlocks,
  LOG_PROTO,
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
} from "./shared.js";
import { createToolCallAggregator } from "../../lib/tool-call-aggregator.js";
import { selectBackendMode, BACKEND_APP_SERVER } from "../../services/backend-mode.js";
import {
  sanitizeMetadataTextSegment,
  extractMetadataFromPayload,
  normalizeMetadataKey,
} from "../../lib/metadata-sanitizer.js";
import { createJsonRpcChildAdapter } from "../../services/transport/child-adapter.js";
import { mapTransportError } from "../../services/transport/index.js";

const API_KEY = CFG.API_KEY;
const DEFAULT_MODEL = CFG.CODEX_MODEL;
const SANDBOX_MODE = CFG.PROXY_SANDBOX_MODE;
const FORCE_PROVIDER = CFG.CODEX_FORCE_PROVIDER.trim();
const IS_DEV_ENV = (CFG.PROXY_ENV || "").toLowerCase() === "dev";
const ACCEPTED_MODEL_IDS = acceptedModelIds(DEFAULT_MODEL);
const REQ_TIMEOUT_MS = CFG.PROXY_TIMEOUT_MS;
const NONSTREAM_TRUNCATE_MS = CFG.PROXY_NONSTREAM_TRUNCATE_AFTER_MS;
const PROTO_IDLE_MS = CFG.PROXY_PROTO_IDLE_MS;
const KILL_ON_DISCONNECT = CFG.PROXY_KILL_ON_DISCONNECT.toLowerCase() !== "false";
const CORS_ENABLED = CFG.PROXY_ENABLE_CORS.toLowerCase() !== "false";
const CORS_ALLOWED = CFG.PROXY_CORS_ALLOWED_ORIGINS;
const applyCors = (req, res) => applyCorsUtil(req, res, CORS_ENABLED, CORS_ALLOWED);
const MAX_CHAT_CHOICES = Math.max(1, Number(CFG.PROXY_MAX_CHAT_CHOICES || 1));
const ENABLE_PARALLEL_TOOL_CALLS = IS_DEV_ENV && CFG.PROXY_ENABLE_PARALLEL_TOOL_CALLS;
const SANITIZE_METADATA = !!CFG.PROXY_SANITIZE_METADATA;

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

const respondWithJson = (res, statusCode, payload) => {
  let body = payload;
  const transform = res?.locals?.responseTransform;
  if (typeof transform === "function") {
    try {
      const transformed = transform(payload, statusCode);
      if (transformed !== undefined) body = transformed;
    } catch (transformErr) {
      console.error("[proxy][chat.nonstream] response transform failed", transformErr);
      if (!res.headersSent) {
        res.status(500).json({
          error: {
            message: "Internal server error during response transformation.",
            type: "server_error",
            code: "response_transform_failed",
          },
        });
      }
      return;
    }
  }

  if (res.headersSent) {
    console.error("[proxy][chat.nonstream] attempted to send JSON after headers were already sent");
    return;
  }

  try {
    res.status(statusCode).json(body);
    return;
  } catch (err) {
    console.error("[proxy][chat.nonstream] res.json() failed, falling back", err);
  }

  if (res.headersSent) {
    console.error("[proxy][chat.nonstream] headers sent during fallback attempt; cannot recover");
    return;
  }

  try {
    res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
  } catch (fallbackErr) {
    console.error("[proxy][chat.nonstream] fallback JSON response failed", fallbackErr);
  }
};

// POST /v1/chat/completions with stream=false
export async function postChatNonStream(req, res) {
  const reqId = nanoid();
  const started = Date.now();
  let responded = false;
  const unknownFinishReasons = new Set();
  const finishReasonTracker = createFinishReasonTracker({
    fallback: "stop",
    onUnknown: (info) => {
      if (!info) return;
      const value = info.value || info.raw;
      if (value) unknownFinishReasons.add(value);
    },
  });
  const toolCallAggregator = createToolCallAggregator();
  let assistantFunctionCall = null;
  let hasToolCalls = false;
  let hasFunctionCall = false;

  const sanitizedMetadataSummary = { count: 0, keys: new Set(), sources: new Set() };
  const seenSanitizedRemovalSignatures = new Set();

  logSanitizerToggle({
    enabled: SANITIZE_METADATA,
    trigger: "request",
    route: "/v1/chat/completions",
    mode: "chat_nonstream",
    reqId,
  });

  const getSanitizerSummaryData = () => ({
    count: sanitizedMetadataSummary.count,
    keys: Array.from(sanitizedMetadataSummary.keys),
    sources: Array.from(sanitizedMetadataSummary.sources),
  });

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
        if (normalizedKey) sanitizedMetadataSummary.keys.add(normalizedKey);
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
        if (normalizedKey) sanitizedMetadataSummary.keys.add(normalizedKey);
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
      mode: "chat_nonstream",
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

  const trackToolSignals = (payload) => {
    if (!payload || typeof payload !== "object") return;
    const toolCalls = payload.tool_calls || payload.toolCalls;
    if (Array.isArray(toolCalls) && toolCalls.length) {
      toolCallAggregator.ingestMessage({ tool_calls: toolCalls });
      hasToolCalls = true;
    }
    const functionCall = payload.function_call || payload.functionCall;
    if (functionCall && typeof functionCall === "object") {
      assistantFunctionCall = functionCall;
      hasFunctionCall = true;
    }
    if (payload.message && typeof payload.message === "object") {
      trackToolSignals(payload.message);
    }
    if (payload.delta && typeof payload.delta === "object") trackToolSignals(payload.delta);
    if (Array.isArray(payload.deltas)) {
      for (const item of payload.deltas) trackToolSignals(item);
    }
    if (payload.arguments && typeof payload.arguments === "object") {
      trackToolSignals(payload.arguments);
    }
  };

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token !== API_KEY) {
    applyCors(null, res);
    return res.status(401).set("WWW-Authenticate", "Bearer realm=api").json(authErrorBody());
  }

  const body = req.body || {};
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) {
    applyCors(null, res);
    return res.status(400).json({
      error: {
        message: "messages[] required",
        type: "invalid_request_error",
        param: "messages",
        code: "invalid_request_error",
      },
    });
  }

  const {
    ok: choiceOk,
    value: requestedChoiceCount = 1,
    error: choiceError,
  } = normalizeChoiceCount(body.n);
  if (!choiceOk) {
    applyCors(null, res);
    return res.status(400).json(choiceError);
  }
  if (requestedChoiceCount < 1 || requestedChoiceCount > MAX_CHAT_CHOICES) {
    applyCors(null, res);
    return res.status(400).json(buildInvalidChoiceError(requestedChoiceCount));
  }
  const choiceCount = requestedChoiceCount;

  const optionalValidation = validateOptionalChatParams(body);
  if (!optionalValidation.ok) {
    applyCors(null, res);
    return res.status(400).json(optionalValidation.error);
  }

  const { requested: requestedModel, effective: effectiveModel } = normalizeModel(
    body.model || DEFAULT_MODEL,
    DEFAULT_MODEL,
    Array.from(ACCEPTED_MODEL_IDS)
  );
  try {
    console.log(
      `[proxy] model requested=${requestedModel} effective=${effectiveModel} stream=${!!body.stream}`
    );
  } catch {}
  if (body.model && !ACCEPTED_MODEL_IDS.has(requestedModel)) {
    applyCors(null, res);
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
  const allowEffort = new Set(["low", "medium", "high", "minimal"]);
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

  const prompt = joinMessages(messages);
  const promptTokensEst = estTokensForMessages(messages);
  const MAX_TOKENS = CFG.PROXY_MAX_PROMPT_TOKENS;
  if (MAX_TOKENS > 0 && promptTokensEst > MAX_TOKENS) {
    applyCors(null, res);
    return res.status(403).json(tokensExceededBody("messages"));
  }

  if (IS_DEV_ENV) {
    try {
      console.log("[dev][prompt][chat] messages=", JSON.stringify(messages));
      console.log("[dev][prompt][chat] joined=\n" + prompt);
      appendProtoEvent({
        ts: Date.now(),
        req_id: reqId,
        route: "/v1/chat/completions",
        mode: "chat",
        kind: "submission",
        payload: { messages, joined: prompt },
      });
    } catch (e) {
      console.error("[dev][prompt][chat] error:", e);
    }
  }

  console.log(`[proxy] spawning backend=${backendMode}:`, resolvedCodexBin, args.join(" "));

  const child =
    backendMode === BACKEND_APP_SERVER
      ? createJsonRpcChildAdapter({ reqId, timeoutMs: REQ_TIMEOUT_MS })
      : spawnCodex(args);
  if (SANITIZE_METADATA) {
    appendProtoEvent({
      ts: Date.now(),
      req_id: reqId,
      route: "/v1/chat/completions",
      mode: "chat_nonstream",
      kind: "metadata_sanitizer_state",
      toggle_enabled: true,
    });
  }
  let out = "",
    err = "";

  const timeout = setTimeout(() => {
    if (responded) return;
    responded = true;
    try {
      child.kill("SIGKILL");
    } catch {}
    applyCors(null, res);
    res.status(504).json({
      error: { message: "backend idle timeout", type: "timeout_error", code: "idle_timeout" },
    });
  }, REQ_TIMEOUT_MS);

  // Dev-only safeguard: early terminate child; finalizeResponse will run on 'close'
  const maybeEarlyTruncate = () => {
    if (!NONSTREAM_TRUNCATE_MS) return { stop() {} };
    const t = setTimeout(() => {
      if (responded) return;
      try {
        child.kill("SIGTERM");
      } catch {}
    }, NONSTREAM_TRUNCATE_MS);
    return {
      stop() {
        try {
          clearTimeout(t);
        } catch {}
      },
    };
  };
  const early = maybeEarlyTruncate();

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  let buf2 = "";
  let content = "";
  let prompt_tokens = 0;
  let completion_tokens = 0;
  let protoIdleReset = () => {};
  let protoIdleCancel = () => {};
  let sawTaskComplete = false;
  const computeFinal = () =>
    content || stripAnsi(out).trim() || stripAnsi(err).trim() || "No output from backend.";

  const logToolBlocks = () => {
    try {
      const final = computeFinal();
      const { blocks } = extractUseToolBlocks(final, 0);
      let idxTool = 0;
      for (const b of blocks || []) {
        appendProtoEvent({
          ts: Date.now(),
          req_id: reqId,
          route: "/v1/chat/completions",
          mode: "chat_nonstream",
          kind: "tool_block",
          idx: ++idxTool,
          char_start: b.start,
          char_end: b.end,
          tool: b.name,
          path: b.path,
          query: b.query,
        });
      }
    } catch {}
  };

  const finalizeResponse = ({ statusCode = 200, finishReason, errorBody } = {}) => {
    if (responded) return;
    responded = true;
    clearTimeout(timeout);
    protoIdleCancel();
    early?.stop?.();

    const final = computeFinal();
    const toolCallsSnapshot = toolCallAggregator.snapshot();
    const toolCallsPayload = toolCallsSnapshot.length ? toolCallsSnapshot : null;
    if (toolCallsPayload) hasToolCalls = true;
    const functionCallPayload = hasFunctionCall ? assistantFunctionCall : null;

    if (finishReason) finishReasonTracker.record(finishReason, "finalize");

    const resolveWithContext = () =>
      finishReasonTracker.resolve({
        hasToolCalls,
        hasFunctionCall,
      });

    let resolvedFinish = resolveWithContext();
    if (!sawTaskComplete && resolvedFinish.reason === "stop") {
      finishReasonTracker.record("length", "fallback_truncation");
      resolvedFinish = resolveWithContext();
    }

    const canonicalReason = resolvedFinish.reason;
    const reasonSource = resolvedFinish.source;
    const unknownReasons = resolvedFinish.unknown || [];
    const reasonTrail = resolvedFinish.trail || [];

    const suppressContent =
      !!toolCallsPayload || !!functionCallPayload || canonicalReason === "content_filter";
    const messageContent = suppressContent ? "" : content && content.length ? content : final;
    const normalizedContent = messageContent && messageContent.length ? messageContent : null;
    const pt =
      Number.isFinite(prompt_tokens) && prompt_tokens > 0 ? prompt_tokens : promptTokensEst;
    const contentForTokenEst = normalizedContent || "";
    const ct =
      Number.isFinite(completion_tokens) && completion_tokens > 0
        ? completion_tokens
        : contentForTokenEst
          ? estTokens(contentForTokenEst)
          : 0;

    const clonedToolCalls = (toolCallsPayload || []).map((entry) => {
      const fn =
        entry.function && typeof entry.function === "object" ? { ...entry.function } : undefined;
      const clone = { ...entry };
      if (fn) clone.function = fn;
      return clone;
    });

    const clonedFunctionCall = functionCallPayload ? { ...functionCallPayload } : null;

    const buildAssistantMessage = () => {
      const msg = { role: "assistant" };
      if (clonedToolCalls.length) {
        msg.tool_calls = clonedToolCalls.map((entry) => ({
          ...entry,
          function:
            entry.function && typeof entry.function === "object"
              ? { ...entry.function }
              : entry.function,
        }));
        msg.content = null;
      } else if (clonedFunctionCall) {
        msg.function_call = { ...clonedFunctionCall };
        msg.content = null;
      } else if (canonicalReason === "content_filter") {
        msg.content = null;
      } else {
        msg.content = normalizedContent;
      }
      return msg;
    };

    if (statusCode === 200) {
      logToolBlocks();
      try {
        if (toolCallsPayload) {
          appendProtoEvent({
            ts: Date.now(),
            req_id: reqId,
            route: "/v1/chat/completions",
            mode: "chat_nonstream",
            kind: "tool_call_summary",
            tool_calls: toolCallsPayload,
            parallel_supported: toolCallAggregator.supportsParallelCalls(),
          });
        }
      } catch {}
      const {
        count: sanitizedMetadataCount,
        keys: sanitizedMetadataKeys,
        sources: sanitizedMetadataSources,
      } = getSanitizerSummaryData();
      if (SANITIZE_METADATA) {
        logSanitizerSummary({
          enabled: true,
          route: "/v1/chat/completions",
          mode: "chat_nonstream",
          reqId,
          count: sanitizedMetadataCount,
          keys: sanitizedMetadataKeys,
          sources: sanitizedMetadataSources,
        });
      }
      appendUsage({
        ts: Date.now(),
        req_id: reqId,
        route: "/v1/chat/completions",
        method: "POST",
        requested_model: requestedModel,
        effective_model: effectiveModel,
        stream: false,
        prompt_tokens_est: pt,
        completion_tokens_est: ct * choiceCount,
        total_tokens_est: pt + ct * choiceCount,
        duration_ms: Date.now() - started,
        status: statusCode,
        user_agent: req.headers["user-agent"] || "",
        finish_reason: canonicalReason,
        finish_reason_source: reasonSource,
        has_tool_calls: !!toolCallsPayload,
        has_function_call: !!functionCallPayload,
        tool_call_parallel_supported: toolCallAggregator.supportsParallelCalls(),
        tool_call_emitted: toolCallAggregator.hasCalls(),
        choice_count: choiceCount,
        metadata_sanitizer_enabled: SANITIZE_METADATA,
        sanitized_metadata_count: SANITIZE_METADATA ? sanitizedMetadataCount : 0,
        sanitized_metadata_keys: SANITIZE_METADATA ? sanitizedMetadataKeys : [],
        sanitized_metadata_sources: SANITIZE_METADATA ? sanitizedMetadataSources : [],
      });
      logFinishReasonTelemetry({
        route: "/v1/chat/completions",
        reqId,
        reason: canonicalReason,
        source: reasonSource,
        hasToolCalls: !!toolCallsPayload,
        hasFunctionCall: !!functionCallPayload,
        unknownReasons: unknownReasons.length ? unknownReasons : Array.from(unknownFinishReasons),
        trail: reasonTrail,
        choiceCount,
      });
      if (SANITIZE_METADATA) {
        appendProtoEvent({
          ts: Date.now(),
          req_id: reqId,
          route: "/v1/chat/completions",
          mode: "chat_nonstream",
          kind: "metadata_sanitizer_summary",
          sanitized_count: sanitizedMetadataCount,
          sanitized_keys: sanitizedMetadataKeys,
          sanitized_sources: sanitizedMetadataSources,
        });
      }
    }

    if (IS_DEV_ENV && statusCode === 200) {
      try {
        console.log("[dev][response][chat][nonstream] content=\n" + final);
      } catch (e) {
        console.error("[dev][response][chat][nonstream] error:", e);
      }
    }

    applyCors(null, res);

    if (statusCode !== 200 && errorBody) {
      respondWithJson(res, statusCode, errorBody);
      return;
    }

    const aggregatedPromptTokens = pt;
    const aggregatedCompletionTokens = ct * choiceCount;
    const aggregatedUsage = {
      prompt_tokens: aggregatedPromptTokens,
      completion_tokens: aggregatedCompletionTokens,
      total_tokens: aggregatedPromptTokens + aggregatedCompletionTokens,
    };

    const assistantMessageTemplate = buildAssistantMessage();
    const choices = Array.from({ length: choiceCount }, (_, idx) => ({
      index: idx,
      message: structuredClone(assistantMessageTemplate),
      finish_reason: canonicalReason,
    }));

    const payload = {
      id: `chatcmpl-${nanoid()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: requestedModel,
      choices,
      usage: aggregatedUsage,
    };

    respondWithJson(res, statusCode, payload);
  };

  ({ reset: protoIdleReset, cancel: protoIdleCancel } = (() => {
    let timer;
    return {
      reset() {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          if (responded) return;
          finalizeResponse({
            statusCode: 504,
            errorBody: {
              error: {
                message: "backend idle timeout",
                type: "timeout_error",
                code: "idle_timeout",
              },
            },
          });
          try {
            child.kill("SIGTERM");
          } catch {}
        }, PROTO_IDLE_MS);
      },
      cancel() {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      },
    };
  })());

  protoIdleReset();

  child.stdout.on("data", (d) => {
    protoIdleReset();
    const s = typeof d === "string" ? d : d.toString("utf8");
    out += s;
    buf2 += s;
    if (LOG_PROTO)
      appendProtoEvent({
        ts: Date.now(),
        req_id: reqId,
        route: "/v1/chat/completions",
        mode: "chat_nonstream",
        kind: "stdout",
        chunk: s,
      });
    let idx;
    while ((idx = buf2.indexOf("\n")) >= 0) {
      const line = buf2.slice(0, idx);
      buf2 = buf2.slice(idx + 1);
      const t = line.trim();
      if (!t) continue;
      try {
        const evt = JSON.parse(t);
        const tp = (evt && (evt.msg?.type || evt.type)) || "";
        appendProtoEvent({
          ts: Date.now(),
          req_id: reqId,
          route: "/v1/chat/completions",
          mode: "chat_nonstream",
          kind: "event",
          event: evt,
        });
        const payload = evt.msg || evt;
        if (payload) {
          const finishCandidate = extractFinishReasonFromMessage(payload);
          if (finishCandidate) finishReasonTracker.record(finishCandidate, tp || "event");
          trackToolSignals(payload);
        }
        const metadataInfo = SANITIZE_METADATA ? extractMetadataFromPayload(payload) : null;
        if (tp === "agent_message_delta" || tp === "agent_message") {
          const isDelta = tp === "agent_message_delta";
          const payloadData = isDelta
            ? (evt.msg?.delta ?? evt.delta)
            : (evt.msg?.message ?? evt.message);

          let textSegment = "";
          let hasTextSegment = false;

          if (typeof payloadData === "string") {
            textSegment = payloadData;
            hasTextSegment = Boolean(textSegment);
          } else if (payloadData && typeof payloadData === "object") {
            if (isDelta) {
              const { updated } = toolCallAggregator.ingestDelta(payloadData);
              if (updated) hasToolCalls = true;
            } else {
              toolCallAggregator.ingestMessage(payloadData);
              if (toolCallAggregator.hasCalls()) hasToolCalls = true;
            }
            textSegment = coerceAssistantContent(payloadData.content ?? payloadData.text ?? "");
            hasTextSegment = Boolean(textSegment);
          }

          const sanitizedSegment = SANITIZE_METADATA
            ? applyMetadataSanitizer(textSegment, metadataInfo, {
                stage: tp,
                eventType: tp,
              })
            : textSegment;

          if (isDelta) {
            content += sanitizedSegment || "";
          } else if (hasTextSegment) {
            content = sanitizedSegment;
          }
        } else if (tp === "metadata") {
          if (SANITIZE_METADATA && metadataInfo) {
            recordSanitizedMetadata({
              stage: "metadata_event",
              eventType: tp,
              metadata: metadataInfo.metadata,
              removed: [],
              sources: metadataInfo.sources,
            });
          }
        } else if (tp === "token_count") {
          prompt_tokens = Number(evt.msg?.prompt_tokens ?? evt.msg?.promptTokens ?? prompt_tokens);
          completion_tokens = Number(
            evt.msg?.completion_tokens ?? evt.msg?.completionTokens ?? completion_tokens
          );
        } else if (tp === "task_complete") {
          sawTaskComplete = true;
          finishReasonTracker.record(
            extractFinishReasonFromMessage(evt.msg || evt),
            "task_complete"
          );
        }
      } catch {}
    }
  });
  child.stderr.on("data", (d) => {
    protoIdleReset();
    err += d.toString("utf8");
    if (LOG_PROTO)
      appendProtoEvent({
        ts: Date.now(),
        req_id: reqId,
        route: "/v1/chat/completions",
        mode: "chat_nonstream",
        kind: "stderr",
        chunk: d.toString("utf8"),
      });
  });

  const finalizeSuccess = () => finalizeResponse();
  const finalizeFailure = (
    error,
    fallbackMessage = "Internal server error from backend process."
  ) => {
    const mapped = mapTransportError(error);
    if (mapped) {
      return finalizeResponse({
        statusCode: mapped.statusCode,
        errorBody: mapped.body,
      });
    }
    const message =
      typeof error === "string"
        ? error
        : error?.message || fallbackMessage || "Internal server error";
    return finalizeResponse({
      statusCode: 500,
      errorBody: {
        error: {
          message,
          type: "server_error",
          code: "backend_error",
        },
      },
    });
  };

  // Stabilize: respond when stdout ends or the process exits, whichever happens first
  child.stdout.on("end", finalizeSuccess);
  child.on("exit", finalizeSuccess);
  child.on("error", (error) => {
    console.error("[proxy][chat.nonstream] child process error", error);
    finalizeFailure(error);
  });
  child.stdout.on("error", (error) => {
    console.error("[proxy][chat.nonstream] stdout error", error);
    finalizeFailure(error, "Internal server error from backend stdout.");
  });
  try {
    const submission = {
      id: reqId,
      op: { type: "user_input", items: [{ type: "text", text: prompt }] },
    };
    child.stdin.write(JSON.stringify(submission) + "\n");
  } catch {}
  req.on("close", () => {
    if (KILL_ON_DISCONNECT) {
      try {
        child.kill("SIGTERM");
      } catch {}
    }
  });
}

// POST /v1/completions with stream=false
export async function postCompletionsNonStream(req, res) {
  const reqId = nanoid();
  const started = Date.now();
  let responded = false;

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token !== API_KEY) {
    applyCors(null, res);
    return res.status(401).set("WWW-Authenticate", "Bearer realm=api").json(authErrorBody());
  }

  const body = req.body || {};
  const prompt = Array.isArray(body.prompt) ? body.prompt.join("\n") : body.prompt || "";
  if (!prompt) {
    applyCors(null, res);
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
    body.model || DEFAULT_MODEL,
    DEFAULT_MODEL,
    Array.from(ACCEPTED_MODEL_IDS)
  );
  if (body.model && !ACCEPTED_MODEL_IDS.has(requestedModel)) {
    applyCors(null, res);
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
  const allowEffort = new Set(["low", "medium", "high", "minimal"]);
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

  console.log(`[proxy] spawning backend=${backendMode}:`, resolvedCodexBin, args.join(" "));

  const child = spawnCodex(args);
  let out = "",
    err = "";

  const timeout = setTimeout(() => {
    if (responded) return;
    responded = true;
    try {
      child.kill("SIGKILL");
    } catch {}
    applyCors(null, res);
    res.status(504).json({
      error: { message: "backend idle timeout", type: "timeout_error", code: "idle_timeout" },
    });
  }, REQ_TIMEOUT_MS);

  let bufN = "";
  let content = "";
  let prompt_tokens = 0;
  let completion_tokens = 0;

  child.stdout.on("data", (d) => {
    const s = d.toString("utf8");
    out += s;
    bufN += s;
    if (LOG_PROTO)
      appendProtoEvent({
        ts: Date.now(),
        req_id: reqId,
        route: "/v1/completions",
        mode: "completions_nonstream",
        kind: "stdout",
        chunk: s,
      });
    let idx;
    while ((idx = bufN.indexOf("\n")) >= 0) {
      const line = bufN.slice(0, idx);
      bufN = bufN.slice(idx + 1);
      const t = line.trim();
      if (!t) continue;
      try {
        const evt = JSON.parse(t);
        const tp = (evt && (evt.msg?.type || evt.type)) || "";
        appendProtoEvent({
          ts: Date.now(),
          req_id: reqId,
          route: "/v1/completions",
          mode: "completions_nonstream",
          kind: "event",
          event: evt,
        });
        if (tp === "agent_message_delta") content += String((evt.msg?.delta ?? evt.delta) || "");
        else if (tp === "agent_message")
          content = String((evt.msg?.message ?? evt.message) || content);
        else if (tp === "token_count") {
          prompt_tokens = Number(evt.msg?.prompt_tokens || prompt_tokens);
          completion_tokens = Number(evt.msg?.completion_tokens || completion_tokens);
        }
      } catch {}
    }
  });
  child.stderr.on("data", (d) => {
    err += d.toString("utf8");
    if (LOG_PROTO)
      appendProtoEvent({
        ts: Date.now(),
        req_id: reqId,
        route: "/v1/completions",
        mode: "completions_nonstream",
        kind: "stderr",
        chunk: d.toString("utf8"),
      });
  });
  child.on("close", () => {
    if (responded) return;
    responded = true;
    clearTimeout(timeout);
    const textOut =
      content || stripAnsi(out).trim() || stripAnsi(err).trim() || "No output from backend.";
    applyCors(null, res);
    const pt = prompt_tokens || promptTokensEst;
    const ct = completion_tokens || estTokens(textOut);
    if (LOG_PROTO) {
      try {
        const { blocks } = extractUseToolBlocks(textOut, 0);
        let idxTool = 0;
        for (const b of blocks || []) {
          appendProtoEvent({
            ts: Date.now(),
            req_id: reqId,
            route: "/v1/completions",
            mode: "completions_nonstream",
            kind: "tool_block",
            idx: ++idxTool,
            char_start: b.start,
            char_end: b.end,
            tool: b.name,
            path: b.path,
            query: b.query,
          });
        }
      } catch {}
    }
    appendUsage({
      ts: Date.now(),
      req_id: reqId,
      route: "/v1/completions",
      method: "POST",
      requested_model: requestedModel,
      effective_model: effectiveModel,
      stream: false,
      prompt_tokens_est: pt,
      completion_tokens_est: ct,
      total_tokens_est: pt + ct,
      duration_ms: Date.now() - started,
      status: 200,
      user_agent: req.headers["user-agent"] || "",
    });
    res.json({
      id: `cmpl-${nanoid()}`,
      object: "text_completion",
      created: Math.floor(Date.now() / 1000),
      model: requestedModel,
      choices: [{ index: 0, text: textOut, logprobs: null, finish_reason: "stop" }],
      usage: { prompt_tokens: pt, completion_tokens: ct, total_tokens: pt + ct },
    });
  });

  try {
    const submission = {
      id: reqId,
      op: { type: "user_input", items: [{ type: "text", text: toSend }] },
    };
    child.stdin.write(JSON.stringify(submission) + "\n");
  } catch {}
}
