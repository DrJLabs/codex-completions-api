import { invalidRequestBody } from "../../lib/errors.js";

export function buildProtoArgs({
  SANDBOX_MODE,
  effectiveModel,
  FORCE_PROVIDER,
  reasoningEffort,
  allowEffort,
  enableParallelTools = false,
}) {
  const args = [
    "proto",
    "--config",
    'preferred_auth_method="chatgpt"',
    "--config",
    "project_doc_max_bytes=0",
    "--config",
    'history.persistence="none"',
    "--config",
    "tools.web_search=false",
    "--config",
    `sandbox_mode="${SANDBOX_MODE}"`,
    "--config",
    `model="${effectiveModel}"`,
  ];
  if (FORCE_PROVIDER) args.push("--config", `model_provider="${FORCE_PROVIDER}"`);
  if (enableParallelTools) args.push("--config", "parallel_tool_calls=true");
  if (allowEffort?.has?.(reasoningEffort)) {
    args.push("--config", `model_reasoning_effort="${reasoningEffort}"`);
    args.push("--config", `reasoning.effort="${reasoningEffort}"`);
  }
  return args;
}

export function buildAppServerArgs({
  SANDBOX_MODE,
  effectiveModel,
  FORCE_PROVIDER,
  reasoningEffort,
  allowEffort,
  enableParallelTools = false,
}) {
  const args = ["app-server", "-c", `model="${effectiveModel}"`];
  const pushConfig = (key, value) => {
    args.push("-c", `${key}=${value}`);
  };

  pushConfig("preferred_auth_method", '"chatgpt"');
  pushConfig("sandbox_mode", `"${SANDBOX_MODE}"`);

  if (FORCE_PROVIDER) pushConfig("model_provider", `"${FORCE_PROVIDER}"`);
  if (enableParallelTools) pushConfig("parallel_tool_calls", "true");
  if (allowEffort?.has?.(reasoningEffort)) {
    pushConfig("model_reasoning_effort", `"${reasoningEffort}"`);
    pushConfig("reasoning.effort", `"${reasoningEffort}"`);
  }

  return args;
}

export function buildBackendArgs({ backendMode, ...rest }) {
  if ((backendMode || "").toLowerCase() === "app-server") {
    return buildAppServerArgs(rest);
  }
  return buildProtoArgs(rest);
}

const CANONICAL_FINISH_REASONS = new Set([
  "stop",
  "length",
  "tool_calls",
  "content_filter",
  "function_call",
]);

const OUTPUT_MODE_CANON = new Map([
  ["obsidian", "obsidian-xml"],
  ["obsidian-xml", "obsidian-xml"],
  ["obsidian_xml", "obsidian-xml"],
  ["openai", "openai-json"],
  ["openai-json", "openai-json"],
  ["openai_json", "openai-json"],
]);

const FINISH_REASON_ALIASES = new Map(
  [
    ["stop", "stop"],
    ["completed", "stop"],
    ["complete", "stop"],
    ["finished", "stop"],
    ["done", "stop"],
    ["halt", "stop"],
    ["cancelled", "stop"],
    ["length", "length"],
    ["max_tokens", "length"],
    ["token_limit", "length"],
    ["token_limit_reached", "length"],
    ["max_tokens_reached", "length"],
    ["truncated", "length"],
    ["tool_calls", "tool_calls"],
    ["tool_call", "tool_calls"],
    ["tool_completion", "tool_calls"],
    ["tool_execution", "tool_calls"],
    ["requires_tool", "tool_calls"],
    ["function_call", "function_call"],
    ["function_calls", "function_call"],
    ["function_execution", "function_call"],
    ["content_filter", "content_filter"],
    ["filtered", "content_filter"],
    ["safety", "content_filter"],
    ["safety_filter", "content_filter"],
    ["moderation", "content_filter"],
    ["policy_filter", "content_filter"],
  ].map(([k, v]) => [k, v])
);

const LENGTH_HINT_KEYS = new Set([
  "token_limit_reached",
  "max_tokens_reached",
  "truncated",
  "length_reached",
  "token_limit",
  "max_tokens",
]);

const TOOL_HINT_REGEX = /tool/;
const FUNCTION_HINT_REGEX = /function/;
const CONTENT_FILTER_HINT_REGEX = /(content[_-]?filter|safety|moderation|policy)/;

const SOURCE_PRIORITY = new Map([
  ["token_count", 0],
  ["stream_idle_timeout", 0],
  ["tool_cutoff", 0],
  ["provider", 1],
  ["task_complete", 1],
  ["finalizer", 2],
  ["finalize", 2],
  ["tool_presence", 2],
  ["function_presence", 2],
  ["fallback", 3],
  ["token_count_fallback", 3],
  ["fallback_truncation", 3],
]);

const coerceString = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return String(value);
};

const flattenContent = (input) => {
  if (input === null || input === undefined) return "";
  if (typeof input === "string") return input;
  if (Array.isArray(input)) return input.map((part) => flattenContent(part)).join("");
  if (typeof input === "object") {
    if (typeof input.text === "string") return input.text;
    if (Array.isArray(input.content)) return flattenContent(input.content);
  }
  return "";
};

export const coerceAssistantContent = flattenContent;

export function canonicalizeFinishReason(raw) {
  if (raw === null || raw === undefined) {
    return { reason: null, normalized: null, unknown: false };
  }
  const normalizedRaw = coerceString(raw).trim();
  if (!normalizedRaw) {
    return { reason: null, normalized: null, unknown: false };
  }
  const lower = normalizedRaw.toLowerCase();
  if (FINISH_REASON_ALIASES.has(lower)) {
    return { reason: FINISH_REASON_ALIASES.get(lower), normalized: lower, unknown: false };
  }
  if (LENGTH_HINT_KEYS.has(lower) || lower.includes("token_limit")) {
    return { reason: "length", normalized: lower, unknown: false };
  }
  if (TOOL_HINT_REGEX.test(lower)) {
    return { reason: "tool_calls", normalized: lower, unknown: false };
  }
  if (FUNCTION_HINT_REGEX.test(lower)) {
    return { reason: "function_call", normalized: lower, unknown: false };
  }
  if (CONTENT_FILTER_HINT_REGEX.test(lower)) {
    return { reason: "content_filter", normalized: lower, unknown: false };
  }
  return { reason: null, normalized: lower, unknown: true };
}

export function resolveFinishReasonPriority(source) {
  if (!source) return Number.POSITIVE_INFINITY;
  return SOURCE_PRIORITY.has(source) ? SOURCE_PRIORITY.get(source) : Number.POSITIVE_INFINITY;
}

const adjustReasonForContext = (reason, { hasToolCalls, hasFunctionCall }) => {
  let nextReason = reason;
  if (hasToolCalls && reason !== "length" && reason !== "content_filter") {
    nextReason = "tool_calls";
  } else if (
    !hasToolCalls &&
    hasFunctionCall &&
    reason !== "length" &&
    reason !== "content_filter" &&
    reason !== "tool_calls"
  ) {
    nextReason = "function_call";
  }
  if (!CANONICAL_FINISH_REASONS.has(nextReason)) {
    return "stop";
  }
  return nextReason;
};

export function createFinishReasonTracker({ fallback = "stop", onUnknown } = {}) {
  const state = {
    fallback,
    bestReason: null,
    bestSource: null,
    bestPriority: Number.POSITIVE_INFINITY,
    trail: [],
    unknown: [],
  };

  return {
    record(raw, source) {
      const entry = { source: source || null, raw };
      const { reason, normalized, unknown } = canonicalizeFinishReason(raw);
      if (unknown && normalized) {
        state.unknown.push({ source: source || null, value: normalized });
        if (typeof onUnknown === "function") {
          try {
            onUnknown({ source: source || null, value: normalized });
          } catch {}
        }
      }
      if (reason) {
        entry.canonical = reason;
        const priority = resolveFinishReasonPriority(source);
        if (state.bestReason === null || priority < state.bestPriority) {
          state.bestPriority = priority;
          state.bestReason = reason;
          state.bestSource = source || null;
        }
      }
      state.trail.push(entry);
      return entry.canonical || null;
    },
    resolve({ hasToolCalls = false, hasFunctionCall = false } = {}) {
      let reason = state.bestReason || state.fallback;
      let source = state.bestReason ? state.bestSource : "fallback";
      const adjusted = adjustReasonForContext(reason, { hasToolCalls, hasFunctionCall });
      if (adjusted !== reason) {
        source = hasToolCalls ? "tool_presence" : hasFunctionCall ? "function_presence" : source;
      }
      return {
        reason: adjusted,
        source,
        trail: state.trail.slice(0),
        unknown: state.unknown.slice(0),
      };
    },
    snapshot() {
      return {
        reason: state.bestReason,
        source: state.bestSource,
        priority: state.bestPriority,
        trail: state.trail.slice(0),
        unknown: state.unknown.slice(0),
      };
    },
  };
}

export function extractFinishReasonFromMessage(msg = {}) {
  if (!msg || typeof msg !== "object") return null;
  const candidateValues = [];
  const direct = msg.finish_reason ?? msg.finishReason ?? msg.reason ?? msg.stop_reason;
  if (direct) candidateValues.push(direct);

  if (msg.token_count || msg.tokenCount) {
    const tokenObj = msg.token_count || msg.tokenCount;
    if (tokenObj) {
      candidateValues.push(
        tokenObj.finish_reason,
        tokenObj.finishReason,
        tokenObj.reason,
        tokenObj.stop_reason
      );
      if (
        tokenObj.token_limit_reached === true ||
        tokenObj.max_tokens_reached === true ||
        tokenObj.truncated === true ||
        tokenObj.length_reached === true ||
        tokenObj.token_limit === true ||
        tokenObj.max_tokens === true
      ) {
        return "length";
      }
    }
  }

  if (
    msg.token_limit_reached === true ||
    msg.max_tokens_reached === true ||
    msg.truncated === true ||
    msg.length_reached === true ||
    msg.token_limit === true ||
    msg.max_tokens === true
  ) {
    return "length";
  }

  for (const candidate of candidateValues) {
    if (candidate === undefined || candidate === null) continue;
    const text = coerceString(candidate).trim();
    if (!text) continue;
    return text;
  }
  return null;
}

export function logFinishReasonTelemetry({
  route,
  reqId,
  reason,
  source,
  trail = [],
  unknownReasons = [],
  hasToolCalls = false,
  hasFunctionCall = false,
  choiceCount,
}) {
  try {
    const payload = {
      route,
      req_id: reqId,
      reason,
      source,
      has_tool_calls: !!hasToolCalls,
      has_function_call: !!hasFunctionCall,
    };
    if (Number.isInteger(choiceCount) && choiceCount > 0) {
      payload.choice_count = choiceCount;
    }
    if (unknownReasons.length) payload.unknown = unknownReasons;
    if (trail.length) payload.trail = trail;
    console.info("[proxy][finish_reason]", JSON.stringify(payload));
  } catch {}
}

const normalizeOutputMode = (raw) => {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim().toLowerCase();
  if (!text) return null;
  if (OUTPUT_MODE_CANON.has(text)) return OUTPUT_MODE_CANON.get(text);
  return null;
};

export function resolveOutputMode({ headerValue, defaultValue } = {}) {
  const fromHeader = normalizeOutputMode(headerValue);
  if (fromHeader) return fromHeader;
  const fromDefault = normalizeOutputMode(defaultValue);
  return fromDefault || "obsidian-xml";
}

export function validateOptionalChatParams(body = {}, { allowJsonSchema = false } = {}) {
  const { logprobs, top_logprobs, response_format, seed } = body;

  if (logprobs) {
    return {
      ok: false,
      error: invalidRequestBody("logprobs", "logprobs is not supported for this model"),
    };
  }

  if (top_logprobs !== undefined && top_logprobs !== null) {
    return {
      ok: false,
      error: invalidRequestBody("top_logprobs", "top_logprobs is not supported"),
    };
  }

  if (response_format !== undefined && response_format !== null) {
    const makeError = () =>
      invalidRequestBody("response_format", 'response_format.type must be "text" when provided');

    if (typeof response_format === "string") {
      const normalized = response_format.toLowerCase();
      if (normalized === "json_schema") {
        if (!allowJsonSchema) {
          return { ok: false, error: makeError() };
        }
      } else if (normalized !== "text") {
        return { ok: false, error: makeError() };
      }
    } else if (typeof response_format === "object") {
      const type = String(response_format.type || "text").toLowerCase();
      if (type === "json_schema") {
        if (!allowJsonSchema) {
          return { ok: false, error: makeError() };
        }
        const schemaValue = response_format.json_schema ?? response_format.schema;
        if (schemaValue !== null && typeof schemaValue !== "object") {
          return {
            ok: false,
            error: invalidRequestBody(
              "response_format.json_schema",
              "json_schema must be an object or null when provided"
            ),
          };
        }
      } else if (type !== "text") {
        return { ok: false, error: makeError() };
      }
    } else {
      return { ok: false, error: makeError() };
    }
  }

  if (seed !== undefined && seed !== null) {
    const seedValue = Number(seed);
    if (!Number.isInteger(seedValue)) {
      return {
        ok: false,
        error: invalidRequestBody("seed", "seed must be an integer"),
      };
    }
  }

  return { ok: true };
}
