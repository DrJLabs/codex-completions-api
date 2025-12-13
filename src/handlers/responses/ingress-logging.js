import { logStructured } from "../../services/logging/schema.js";
import { ensureReqId } from "../../lib/request-context.js";
import { ensureCopilotTraceId } from "../../lib/trace-ids.js";

const RESPONSES_ROUTE = "/v1/responses";

const isNonEmptyString = (value) => typeof value === "string" && value.trim() !== "";

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

export function summarizeResponsesIngress(body = {}) {
  const input = body?.input;
  const inputItems = resolveInputItems(body);
  const itemTypes = new Set();
  let hasToolOutputItems = false;
  let toolOutputBytesTotal = 0;
  let toolOutputBytesKnown = true;

  if (Array.isArray(inputItems)) {
    for (const item of inputItems) {
      if (!item) continue;
      if (typeof item === "object") {
        if (typeof item.type === "string") itemTypes.add(item.type);
        if (item.type === "tool_output") {
          hasToolOutputItems = true;
          const bytes = item.output === undefined ? null : safeByteLength(item.output);
          if (bytes === null) toolOutputBytesKnown = false;
          else toolOutputBytesTotal += bytes;
        }
      }
    }
  }

  return {
    has_messages: Array.isArray(body?.messages) && body.messages.length > 0,
    has_instructions: isNonEmptyString(body?.instructions),
    has_input: input !== undefined,
    input_is_array: Array.isArray(input),
    input_item_types: Array.from(itemTypes),
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
        ...summarizeResponsesIngress(body),
      }
    );
  } catch {
    // Logging is best-effort; swallow any errors.
  }
}
