import { logStructured } from "../../services/logging/schema.js";
import { ensureReqId } from "../../lib/request-context.js";
import { ensureCopilotTraceId } from "../../lib/trace-ids.js";

const RESPONSES_ROUTE = "/v1/responses";

const isNonEmptyString = (value) => typeof value === "string" && value.trim() !== "";

const isPlainObject = (value) =>
  value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value);

const normalizeKey = (value) => {
  if (value === null || value === undefined) return "";
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
};

const summarizeKeys = (candidate, { maxKeys = 25 } = {}) => {
  if (!isPlainObject(candidate)) {
    return { has: false, key_count: 0, keys: [], keys_truncated: false };
  }
  const keys = Array.from(
    new Set(
      Object.keys(candidate)
        .map((key) => normalizeKey(key))
        .filter(Boolean)
    )
  ).sort();
  return {
    has: keys.length > 0,
    key_count: keys.length,
    keys: keys.slice(0, Math.max(0, maxKeys)),
    keys_truncated: keys.length > maxKeys,
  };
};

const summarizeCandidateHeaders = (headers, { maxKeys = 20 } = {}) => {
  if (!headers || typeof headers !== "object") {
    return {
      has_candidate_headers: false,
      candidate_header_keys: [],
      candidate_header_keys_truncated: false,
    };
  }
  const INTERESTING = /(session|conversation|thread|chat|copilot|obsidian|idempotency)/i;
  const FORBIDDEN = new Set([
    "authorization",
    "cookie",
    "set-cookie",
    "proxy-authorization",
    "x-api-key",
  ]);
  const keys = Array.from(
    new Set(
      Object.keys(headers)
        .map((key) =>
          String(key || "")
            .trim()
            .toLowerCase()
        )
        .filter((key) => key && !FORBIDDEN.has(key) && INTERESTING.test(key))
    )
  ).sort();
  return {
    has_candidate_headers: keys.length > 0,
    candidate_header_keys: keys.slice(0, Math.max(0, maxKeys)),
    candidate_header_keys_truncated: keys.length > maxKeys,
  };
};

const summarizeCandidateIdFields = (body, { maxFields = 10 } = {}) => {
  if (!isPlainObject(body)) {
    return { candidate_id_fields_present: [], candidate_id_fields_truncated: false };
  }
  const CANDIDATES = [
    { canon: "conversation_id", variants: ["conversation_id", "conversationId"] },
    { canon: "session_id", variants: ["session_id", "sessionId"] },
    { canon: "thread_id", variants: ["thread_id", "threadId"] },
    { canon: "chat_id", variants: ["chat_id", "chatId"] },
    {
      canon: "client_conversation_id",
      variants: ["client_conversation_id", "clientConversationId"],
    },
    { canon: "client_session_id", variants: ["client_session_id", "clientSessionId"] },
    { canon: "idempotency_key", variants: ["idempotency_key", "idempotencyKey"] },
  ];
  const present = [];
  for (const candidate of CANDIDATES) {
    for (const variant of candidate.variants) {
      // eslint-disable-next-line security/detect-object-injection -- variant list is static
      const value = body[variant];
      if (value === undefined || value === null) continue;
      if (typeof value === "string" && value.trim() === "") continue;
      present.push(candidate.canon);
      break;
    }
  }
  const unique = Array.from(new Set(present)).sort();
  return {
    candidate_id_fields_present: unique.slice(0, Math.max(0, maxFields)),
    candidate_id_fields_truncated: unique.length > maxFields,
  };
};

const resolveInputItems = (body) => {
  const input = body?.input;
  if (Array.isArray(input)) return input;
  if (input && typeof input === "object" && Array.isArray(input.content)) return input.content;
  return null;
};

const safeByteLength = (value) => {
  if (value === undefined || value === null) return 0;
  if (typeof value === "string") return Buffer.byteLength(value, "utf8");
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return null;
  }
};

export function summarizeResponsesIngress(body = {}, req = null) {
  const input = body?.input;
  const inputItems = resolveInputItems(body);
  const itemTypes = new Set();
  const messageRoles = new Set();
  const inputMetadataKeys = new Set();
  let hasToolOutputItems = false;
  let hasInputItemMetadata = false;
  let toolOutputBytesTotal = 0;
  let toolOutputBytesKnown = true;
  let inputItemCount = null;
  let inputMessageCount = 0;

  if (Array.isArray(inputItems)) {
    inputItemCount = inputItems.length;
    for (const item of inputItems) {
      if (!item) continue;
      if (typeof item === "object") {
        if (typeof item.type === "string") itemTypes.add(item.type);
        if (item.type === "message") {
          inputMessageCount += 1;
          if (typeof item.role === "string" && item.role.trim()) {
            messageRoles.add(item.role.trim().toLowerCase());
          }
        }
        if (isPlainObject(item.metadata)) {
          hasInputItemMetadata = true;
          for (const key of Object.keys(item.metadata)) {
            const normalized = normalizeKey(key);
            if (normalized) inputMetadataKeys.add(normalized);
          }
        }
        if (item.type === "tool_output") {
          hasToolOutputItems = true;
          const bytes = item.output === undefined ? null : safeByteLength(item.output);
          if (bytes === null) toolOutputBytesKnown = false;
          else toolOutputBytesTotal += bytes;
        }
      }
    }
  }

  const metadataSummary = summarizeKeys(body?.metadata, { maxKeys: 25 });
  const inputMetadataKeyList = Array.from(inputMetadataKeys).sort();
  const sessionKeyRe = /(session|conversation|thread|chat|idempotency)/i;

  return {
    has_messages: Array.isArray(body?.messages) && body.messages.length > 0,
    has_instructions: isNonEmptyString(body?.instructions),
    has_input: input !== undefined,
    input_is_array: Array.isArray(input),
    input_item_count: inputItemCount,
    input_item_types: Array.from(itemTypes),
    input_message_count: inputMessageCount,
    input_message_roles: Array.from(messageRoles).slice(0, 10),
    has_input_item_metadata: hasInputItemMetadata,
    input_item_metadata_keys: inputMetadataKeyList.slice(0, 25),
    input_item_metadata_keys_truncated: inputMetadataKeyList.length > 25,
    has_metadata: metadataSummary.has,
    metadata_keys: metadataSummary.keys,
    metadata_keys_truncated: metadataSummary.keys_truncated,
    has_session_like_metadata_key: metadataSummary.keys.some((key) => sessionKeyRe.test(key)),
    has_tools: Array.isArray(body?.tools) && body.tools.length > 0,
    has_tool_choice: body?.tool_choice !== undefined,
    has_previous_response_id: isNonEmptyString(body?.previous_response_id),
    has_tool_output_items: hasToolOutputItems,
    tool_output_bytes_total: hasToolOutputItems
      ? toolOutputBytesKnown
        ? toolOutputBytesTotal
        : null
      : null,
    model: typeof body?.model === "string" ? body.model : null,
    ...summarizeCandidateIdFields(body, { maxFields: 10 }),
    ...summarizeCandidateHeaders(req?.headers, { maxKeys: 20 }),
  };
}

export function logResponsesIngressRaw({
  req,
  res,
  body,
  outputModeRequested = null,
  outputModeEffective = null,
} = {}) {
  if (!req || !res) return;
  try {
    const reqId = ensureReqId(res);
    const copilotTraceId = ensureCopilotTraceId(req, res);
    const route = res.locals?.routeOverride || RESPONSES_ROUTE;
    const mode = res.locals?.modeOverride || res.locals?.mode || null;
    logStructured(
      {
        component: "responses",
        event: "responses_ingress_raw",
        level: "info",
        req_id: reqId,
        trace_id: res.locals?.trace_id,
        route,
        mode,
        method: req.method,
      },
      {
        endpoint_mode: "responses",
        copilot_trace_id: copilotTraceId,
        stream: Boolean(body?.stream),
        output_mode_requested: outputModeRequested,
        output_mode_effective: outputModeEffective,
        ...summarizeResponsesIngress(body, req),
      }
    );
  } catch {
    // Logging is best-effort; swallow any errors.
  }
}
