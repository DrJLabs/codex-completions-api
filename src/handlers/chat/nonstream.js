import { spawnCodex, resolvedCodexBin } from "../../services/codex-runner.js";
import { installJsonLogger } from "../../services/sse.js";
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
  resolveOutputMode,
} from "./shared.js";
import { createToolCallAggregator, toObsidianXml } from "../../lib/tool-call-aggregator.js";
import { selectBackendMode, BACKEND_APP_SERVER } from "../../services/backend-mode.js";
import {
  sanitizeMetadataTextSegment,
  extractMetadataFromPayload,
  normalizeMetadataKey,
} from "../../lib/metadata-sanitizer.js";
import { createJsonRpcChildAdapter } from "../../services/transport/child-adapter.js";
import { normalizeChatJsonRpcRequest, ChatJsonRpcNormalizationError } from "./request.js";
import { mapTransportError } from "../../services/transport/index.js";
import { ensureReqId, setHttpContext, getHttpContext } from "../../lib/request-context.js";
import { logHttpRequest } from "../../dev-trace/http.js";

const fingerprintToolCall = (record) => {
  if (!record || typeof record !== "object") return null;
  if (record.id && typeof record.id === "string") return `id:${record.id}`;
  const fn = record.function && typeof record.function === "object" ? record.function : {};
  const name = typeof fn.name === "string" ? fn.name : "";
  const args = typeof fn.arguments === "string" ? fn.arguments : "";
  return `fn:${name}:${args}`;
};

const normalizeToolCallSnapshot = (snapshot = []) => {
  const list = Array.isArray(snapshot) ? snapshot.slice() : [];
  let next = list;
  if (TOOL_BLOCK_DEDUP && next.length) {
    const seen = new Set();
    next = next.filter((record) => {
      const fingerprint = fingerprintToolCall(record);
      if (!fingerprint) return true;
      if (seen.has(fingerprint)) return false;
      seen.add(fingerprint);
      return true;
    });
  }
  const maxBlocks = Number(CFG.PROXY_TOOL_BLOCK_MAX || 0);
  const truncated = maxBlocks > 0 && next.length > maxBlocks;
  const records = truncated ? next.slice(0, maxBlocks) : next;
  return { records, truncated, observedCount: next.length };
};

const joinToolBlocks = (blocks = []) => {
  if (!blocks.length) return null;
  if (!TOOL_BLOCK_DELIMITER) return blocks.join("");
  return blocks.join(TOOL_BLOCK_DELIMITER);
};

const trimTrailingTextAfterToolBlocks = (content = "") => {
  if (!content || typeof content !== "string") return content;
  const lastClose = content.lastIndexOf("</use_tool>");
  if (lastClose === -1) return content;
  return content.slice(0, lastClose + "</use_tool>".length).trim();
};

export const buildCanonicalXml = (snapshot = []) => {
  if (!Array.isArray(snapshot) || !snapshot.length) return null;
  const { records } = normalizeToolCallSnapshot(snapshot);
  const xmlBlocks = [];
  for (const record of records) {
    const args = record?.function?.arguments || "";
    if (!args) continue;
    try {
      JSON.parse(args);
    } catch (err) {
      console.error("[proxy][chat.nonstream] failed to build obsidian XML", err);
      continue;
    }
    const xml = toObsidianXml(record);
    if (xml) xmlBlocks.push(xml);
  }
  return joinToolBlocks(xmlBlocks);
};

export const extractTextualUseToolBlock = (text) => {
  if (!text || !text.length) return null;
  try {
    const { blocks } = extractUseToolBlocks(text, 0);
    if (!blocks || !blocks.length) return null;
    const seen = TOOL_BLOCK_DEDUP ? new Set() : null;
    const results = [];
    for (const block of blocks) {
      const start = Number.isInteger(block.start)
        ? block.start
        : Number.isInteger(block.indexStart)
          ? block.indexStart
          : 0;
      const end = Number.isInteger(block.end)
        ? block.end
        : Number.isInteger(block.indexEnd)
          ? block.indexEnd
          : text.length;
      const literal = text.slice(start, end);
      if (!literal) continue;
      if (seen) {
        if (seen.has(literal)) continue;
        seen.add(literal);
      }
      results.push(literal);
    }
    return joinToolBlocks(results);
  } catch {}
  return null;
};

export const buildAssistantMessage = ({
  snapshot = [],
  choiceContent = "",
  normalizedContent = "",
  canonicalReason = "stop",
  isObsidianOutput = true,
  functionCallPayload = null,
} = {}) => {
  const { records: toolCallRecords, truncated: toolCallsTruncated } =
    normalizeToolCallSnapshot(snapshot);
  const hasToolCalls = toolCallRecords.length > 0;
  let assistantContent = choiceContent && choiceContent.length ? choiceContent : normalizedContent;
  if (canonicalReason === "content_filter") {
    assistantContent = null;
  } else if (hasToolCalls) {
    assistantContent = isObsidianOutput
      ? buildCanonicalXml(toolCallRecords) ||
        extractTextualUseToolBlock(choiceContent) ||
        normalizedContent ||
        choiceContent
      : null;
  } else if (functionCallPayload) {
    assistantContent = null;
  }

  const message = { role: "assistant" };
  if (hasToolCalls) {
    message.tool_calls = toolCallRecords.map((entry) => ({
      ...entry,
      function:
        entry.function && typeof entry.function === "object"
          ? { ...entry.function }
          : entry.function,
    }));
    message.content = assistantContent;
  } else if (functionCallPayload) {
    message.function_call = { ...functionCallPayload };
    message.content = assistantContent;
  } else {
    message.content = assistantContent;
  }

  if (typeof message.content === "string" && message.content.includes("</use_tool>")) {
    message.content = trimTrailingTextAfterToolBlocks(message.content);
  }

  return { message, hasToolCalls, toolCallsTruncated, toolCallCount: toolCallRecords.length };
};

const API_KEY = CFG.API_KEY;
const DEFAULT_MODEL = CFG.CODEX_MODEL;
const SANDBOX_MODE = CFG.PROXY_SANDBOX_MODE;
const CODEX_WORKDIR = CFG.PROXY_CODEX_WORKDIR;
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
const TOOL_BLOCK_DEDUP = !!CFG.PROXY_TOOL_BLOCK_DEDUP;
const TOOL_BLOCK_DELIMITER =
  typeof CFG.PROXY_TOOL_BLOCK_DELIMITER === "string" ? CFG.PROXY_TOOL_BLOCK_DELIMITER : "";
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
  stream = false,
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
      console.error("[dev][usage][nonstream] failed to append usage", err);
    }
  }
};

const resolveEmissionTrigger = (trail, fallback = "error") => {
  if (!Array.isArray(trail) || trail.length === 0) return fallback;
  const last = trail[trail.length - 1];
  if (!last) return fallback;
  if (typeof last === "string") return last || fallback;
  if (typeof last === "object") {
    return last.canonical || last.raw || last.source || fallback;
  }
  return fallback;
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
  setHttpContext(res, { route: "/v1/chat/completions", mode: "chat_nonstream" });
  const reqId = ensureReqId(res);
  installJsonLogger(res);
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
  const choiceStates = new Map();

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
    const nested = [candidate.msg, candidate.message, candidate.delta, candidate.payload];
    for (const entry of nested) {
      const resolved = extractChoiceIndex(entry, visited);
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

  const getChoiceState = (choiceIndex = 0) => {
    const normalized = Number.isInteger(choiceIndex) && choiceIndex >= 0 ? choiceIndex : 0;
    if (!choiceStates.has(normalized)) {
      choiceStates.set(normalized, {
        index: normalized,
        content: "",
      });
    }
    return choiceStates.get(normalized);
  };

  const choiceHasToolCalls = (choiceIndex = 0) => {
    const normalized = Number.isInteger(choiceIndex) && choiceIndex >= 0 ? choiceIndex : 0;
    return toolCallAggregator.hasCalls({ choiceIndex: normalized });
  };

  const determineChoiceFinishReason = (choiceIndex, fallbackReason, hasChoiceTools = false) => {
    if (hasChoiceTools || choiceHasToolCalls(choiceIndex)) return "tool_calls";
    if (fallbackReason === "tool_calls") return "stop";
    return fallbackReason;
  };

  const getPrimaryContent = () => {
    if (choiceStates.size) {
      const sorted = Array.from(choiceStates.keys()).sort((a, b) => a - b);
      for (const idx of sorted) {
        const state = choiceStates.get(idx);
        if (state?.content) return state.content;
      }
    }
    return "";
  };

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

  const trackToolSignals = (payload, fallbackChoiceIndex = null) => {
    if (!payload || typeof payload !== "object") return;
    const resolvedChoiceIndex = (() => {
      const idx = resolveChoiceIndexFromPayload(payload);
      if (Number.isInteger(idx) && idx >= 0) return idx;
      if (Number.isInteger(fallbackChoiceIndex) && fallbackChoiceIndex >= 0)
        return fallbackChoiceIndex;
      return 0;
    })();
    const toolCalls = payload.tool_calls || payload.toolCalls;
    if (Array.isArray(toolCalls) && toolCalls.length) {
      hasToolCalls = true;
    }
    const functionCall = payload.function_call || payload.functionCall;
    if (functionCall && typeof functionCall === "object") {
      assistantFunctionCall = functionCall;
      hasFunctionCall = true;
    }
    if (payload.message && typeof payload.message === "object") {
      trackToolSignals(payload.message, resolvedChoiceIndex);
    }
    if (payload.delta && typeof payload.delta === "object")
      trackToolSignals(payload.delta, resolvedChoiceIndex);
    if (Array.isArray(payload.deltas)) {
      for (const item of payload.deltas) trackToolSignals(item, resolvedChoiceIndex);
    }
    if (payload.arguments && typeof payload.arguments === "object") {
      trackToolSignals(payload.arguments, resolvedChoiceIndex);
    }
  };

  const body = req.body || {};
  logHttpRequest({
    req,
    res,
    route: "/v1/chat/completions",
    mode: "chat_nonstream",
    body,
  });

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token !== API_KEY) {
    logUsageFailure({
      req,
      res,
      reqId,
      started,
      route: "/v1/chat/completions",
      mode: "chat_nonstream",
      statusCode: 401,
      reason: "auth_error",
      errorCode: "unauthorized",
    });
    applyCors(null, res);
    return res.status(401).set("WWW-Authenticate", "Bearer realm=api").json(authErrorBody());
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) {
    logUsageFailure({
      req,
      res,
      reqId,
      started,
      route: "/v1/chat/completions",
      mode: "chat_nonstream",
      statusCode: 400,
      reason: "invalid_request",
      errorCode: "messages_required",
    });
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
    logUsageFailure({
      req,
      res,
      reqId,
      started,
      route: "/v1/chat/completions",
      mode: "chat_nonstream",
      statusCode: 400,
      reason: "invalid_request",
      errorCode: choiceError?.error?.code || "invalid_choice",
    });
    applyCors(null, res);
    return res.status(400).json(choiceError);
  }
  if (requestedChoiceCount < 1 || requestedChoiceCount > MAX_CHAT_CHOICES) {
    logUsageFailure({
      req,
      res,
      reqId,
      started,
      route: "/v1/chat/completions",
      mode: "chat_nonstream",
      statusCode: 400,
      reason: "invalid_request",
      errorCode: "invalid_choice_range",
    });
    applyCors(null, res);
    return res.status(400).json(buildInvalidChoiceError(requestedChoiceCount));
  }
  const choiceCount = requestedChoiceCount;
  const outputMode = resolveOutputMode({
    headerValue: req.headers["x-proxy-output-mode"],
    defaultValue: CFG.PROXY_OUTPUT_MODE,
  });
  res.setHeader("x-proxy-output-mode", outputMode);
  const isObsidianOutput = outputMode === "obsidian-xml";

  const backendMode = selectBackendMode();

  const optionalValidation = validateOptionalChatParams(body, {
    allowJsonSchema: backendMode === BACKEND_APP_SERVER,
  });
  if (!optionalValidation.ok) {
    logUsageFailure({
      req,
      res,
      reqId,
      started,
      route: "/v1/chat/completions",
      mode: "chat_nonstream",
      statusCode: 400,
      reason: "invalid_optional_params",
      errorCode: optionalValidation.error?.error?.code,
    });
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
    logUsageFailure({
      req,
      res,
      reqId,
      started,
      route: "/v1/chat/completions",
      mode: "chat_nonstream",
      statusCode: 404,
      reason: "model_not_found",
      errorCode: "model_not_found",
      requestedModel,
    });
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
      mode: "chat_nonstream",
      statusCode: 403,
      reason: "tokens_exceeded",
      requestedModel,
      effectiveModel,
      errorCode: "prompt_too_large",
    });
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

  let normalizedRequest = null;
  if (backendMode === BACKEND_APP_SERVER) {
    try {
      normalizedRequest = normalizeChatJsonRpcRequest({
        body,
        messages,
        prompt,
        reqId,
        requestedModel,
        effectiveModel,
        choiceCount,
        stream: false,
        reasoningEffort,
        sandboxMode: SANDBOX_MODE,
        codexWorkdir: CODEX_WORKDIR,
        approvalMode: APPROVAL_POLICY,
      });
    } catch (err) {
      if (err instanceof ChatJsonRpcNormalizationError) {
        logUsageFailure({
          req,
          res,
          reqId,
          started,
          route: "/v1/chat/completions",
          mode: "chat_nonstream",
          statusCode: err.statusCode || 400,
          reason: "normalization_error",
          errorCode: err.body?.error?.code || err.code,
          requestedModel,
          effectiveModel,
        });
        applyCors(null, res);
        return res.status(err.statusCode).json(err.body);
      }
      throw err;
    }
  }

  const nonStreamTrace = { reqId, route: "/v1/chat/completions", mode: "chat_nonstream" };
  const child =
    backendMode === BACKEND_APP_SERVER
      ? createJsonRpcChildAdapter({
          reqId,
          timeoutMs: REQ_TIMEOUT_MS,
          normalizedRequest,
          trace: nonStreamTrace,
        })
      : spawnCodex(args, {
          reqId,
          route: nonStreamTrace.route,
          mode: nonStreamTrace.mode,
        });
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
    logUsageFailure({
      req,
      res,
      reqId,
      started,
      route: "/v1/chat/completions",
      mode: "chat_nonstream",
      statusCode: 504,
      reason: "backend_idle_timeout",
      errorCode: "idle_timeout",
      requestedModel,
      effectiveModel,
    });
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

  res.setHeader("x-codex-stop-after-tools-mode", CFG.PROXY_STOP_AFTER_TOOLS_MODE || "burst");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  let buf2 = "";
  let prompt_tokens = 0;
  let completion_tokens = 0;
  let protoIdleReset = () => {};
  let protoIdleCancel = () => {};
  let sawTaskComplete = false;
  let totalToolCallCount = 0;
  let hasTruncatedToolCalls = false;
  const computeFinal = () =>
    getPrimaryContent() ||
    stripAnsi(out).trim() ||
    stripAnsi(err).trim() ||
    "No output from backend.";

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
    if (toolCallAggregator.hasCalls()) hasToolCalls = true;

    if (finishReason) finishReasonTracker.record(finishReason, "finalize");

    const resolveWithContext = () =>
      finishReasonTracker.resolve({
        hasToolCalls,
        hasFunctionCall,
      });

    let resolvedFinish = resolveWithContext();
    if (!sawTaskComplete && resolvedFinish.reason === "stop") {
      finishReasonTracker.record("stop", "fallback_truncation");
      resolvedFinish = resolveWithContext();
    }

    const canonicalReason = resolvedFinish.reason;
    const reasonSource = resolvedFinish.source;
    const unknownReasons = resolvedFinish.unknown || [];
    const reasonTrail = resolvedFinish.trail || [];

    const defaultContent = getPrimaryContent();
    const normalizedContent = defaultContent && defaultContent.length ? defaultContent : null;

    const buildAssistantMessageForChoice = (idx) => {
      const snapshot = toolCallAggregator.snapshot({ choiceIndex: idx });
      const state = getChoiceState(idx);
      const choiceContent = state.content && state.content.length ? state.content : final;
      const result = buildAssistantMessage({
        snapshot,
        choiceContent,
        normalizedContent,
        canonicalReason,
        isObsidianOutput,
        functionCallPayload,
      });
      if (Number.isFinite(result.toolCallCount)) {
        totalToolCallCount += result.toolCallCount;
      }
      if (result.toolCallsTruncated) {
        hasTruncatedToolCalls = true;
      }
      return result;
    };

    const pt =
      Number.isFinite(prompt_tokens) && prompt_tokens > 0 ? prompt_tokens : promptTokensEst;
    const contentForTokenEst = normalizedContent || "";
    const ct =
      Number.isFinite(completion_tokens) && completion_tokens > 0
        ? completion_tokens
        : contentForTokenEst
          ? estTokens(contentForTokenEst)
          : 0;

    if (statusCode === 200) {
      logToolBlocks();
      try {
        if (toolCallAggregator.hasCalls()) {
          const snapshots = [];
          for (let idx = 0; idx < choiceCount; idx += 1) {
            const snapshot = toolCallAggregator.snapshot({ choiceIndex: idx });
            if (snapshot.length) snapshots.push({ choice_index: idx, tool_calls: snapshot });
          }
          appendProtoEvent({
            ts: Date.now(),
            req_id: reqId,
            route: "/v1/chat/completions",
            mode: "chat_nonstream",
            kind: "tool_call_summary",
            tool_calls: snapshots.flatMap((entry) =>
              entry.tool_calls.map((record) => ({ ...record, choice_index: entry.choice_index }))
            ),
            tool_calls_by_choice: snapshots,
            parallel_supported: toolCallAggregator.supportsParallelCalls(),
            tool_call_count_total: totalToolCallCount,
            tool_call_truncated_total: hasTruncatedToolCalls ? 1 : 0,
            stop_after_tools_mode: CFG.PROXY_STOP_AFTER_TOOLS_MODE || "burst",
            stop_after_tools_enabled: Boolean(CFG.PROXY_STOP_AFTER_TOOLS),
            tool_block_max: Number(CFG.PROXY_TOOL_BLOCK_MAX || 0),
            suppress_tail_after_tools: Boolean(CFG.PROXY_SUPPRESS_TAIL_AFTER_TOOLS),
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
      const httpCtx = getHttpContext(res);
      appendUsage({
        req_id: reqId,
        route: httpCtx.route || "/v1/chat/completions",
        mode: httpCtx.mode || "chat_nonstream",
        method: req.method || "POST",
        status_code: statusCode,
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
        tool_call_count_total: totalToolCallCount,
        tool_call_truncated_total: hasTruncatedToolCalls ? 1 : 0,
        stop_after_tools_mode: CFG.PROXY_STOP_AFTER_TOOLS_MODE || "burst",
        choice_count: choiceCount,
        metadata_sanitizer_enabled: SANITIZE_METADATA,
        sanitized_metadata_count: SANITIZE_METADATA ? sanitizedMetadataCount : 0,
        sanitized_metadata_keys: SANITIZE_METADATA ? sanitizedMetadataKeys : [],
        sanitized_metadata_sources: SANITIZE_METADATA ? sanitizedMetadataSources : [],
        output_mode: outputMode,
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
      const emissionTrigger = resolveEmissionTrigger(reasonTrail);
      logUsageFailure({
        req,
        res,
        reqId,
        started,
        route: "/v1/chat/completions",
        mode: "chat_nonstream",
        statusCode,
        reason: emissionTrigger,
        errorCode: errorBody?.error?.code,
        requestedModel,
        effectiveModel,
      });
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

    const choices = Array.from({ length: choiceCount }, (_, idx) => {
      const { message, hasToolCalls: choiceHasTools } = buildAssistantMessageForChoice(idx);
      return {
        index: idx,
        message,
        finish_reason: determineChoiceFinishReason(idx, canonicalReason, choiceHasTools),
      };
    });

    res.setHeader("x-codex-tool-call-count", String(totalToolCallCount));
    res.setHeader("x-codex-tool-call-truncated", String(hasTruncatedToolCalls));

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
          const choiceIndex = resolveChoiceIndexFromPayload(payloadData, evt.msg, evt) ?? 0;
          const choiceState = getChoiceState(choiceIndex);

          let textSegment = "";
          let hasTextSegment = false;

          if (typeof payloadData === "string") {
            textSegment = payloadData;
            hasTextSegment = Boolean(textSegment);
            toolCallAggregator.ingestMessage(
              { message: { content: payloadData } },
              { choiceIndex, emitIfMissing: true }
            );
            if (toolCallAggregator.hasCalls({ choiceIndex })) hasToolCalls = true;
          } else if (payloadData && typeof payloadData === "object") {
            if (isDelta) {
              const { updated } = toolCallAggregator.ingestDelta(payloadData, {
                choiceIndex,
              });
              if (updated) hasToolCalls = true;
            } else {
              toolCallAggregator.ingestMessage(payloadData, {
                choiceIndex,
                emitIfMissing: true,
              });
              if (toolCallAggregator.hasCalls({ choiceIndex })) hasToolCalls = true;
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
            choiceState.content += sanitizedSegment || "";
          } else if (hasTextSegment) {
            choiceState.content = sanitizedSegment;
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
  setHttpContext(res, { route: "/v1/completions", mode: "completions_nonstream" });
  const reqId = ensureReqId(res);
  installJsonLogger(res);
  const started = Date.now();
  let responded = false;

  const body = req.body || {};
  logHttpRequest({
    req,
    res,
    route: "/v1/completions",
    mode: "completions_nonstream",
    body,
  });

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token !== API_KEY) {
    logUsageFailure({
      req,
      res,
      reqId,
      started,
      route: "/v1/completions",
      mode: "completions_nonstream",
      statusCode: 401,
      reason: "auth_error",
      errorCode: "unauthorized",
      stream: false,
    });
    applyCors(null, res);
    return res.status(401).set("WWW-Authenticate", "Bearer realm=api").json(authErrorBody());
  }

  const prompt = Array.isArray(body.prompt) ? body.prompt.join("\n") : body.prompt || "";

  if (!prompt) {
    logUsageFailure({
      req,
      res,
      reqId,
      started,
      route: "/v1/completions",
      mode: "completions_nonstream",
      statusCode: 400,
      reason: "invalid_request",
      errorCode: "prompt_required",
      stream: false,
    });
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
    logUsageFailure({
      req,
      res,
      reqId,
      started,
      route: "/v1/completions",
      mode: "completions_nonstream",
      statusCode: 404,
      reason: "model_not_found",
      errorCode: "model_not_found",
      requestedModel,
      stream: false,
    });
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

  const child = spawnCodex(args, {
    reqId,
    route: "/v1/completions",
    mode: "completions_nonstream",
  });
  let out = "",
    err = "";

  const timeout = setTimeout(() => {
    if (responded) return;
    responded = true;
    try {
      child.kill("SIGKILL");
    } catch {}
    applyCors(null, res);
    logUsageFailure({
      req,
      res,
      reqId,
      started,
      route: "/v1/completions",
      mode: "completions_nonstream",
      statusCode: 504,
      reason: "backend_idle_timeout",
      errorCode: "idle_timeout",
      requestedModel,
      effectiveModel,
      stream: false,
    });
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
    const completionsCtx = getHttpContext(res);
    appendUsage({
      req_id: reqId,
      route: completionsCtx.route || "/v1/completions",
      mode: completionsCtx.mode || "completions_nonstream",
      method: req.method || "POST",
      status_code: 200,
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
