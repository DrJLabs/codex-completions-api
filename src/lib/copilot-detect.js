const isNonEmptyString = (value) => typeof value === "string" && value.trim() !== "";

const normalizeHeaders = (headers = {}) => {
  const normalized = {};
  for (const [key, value] of Object.entries(headers)) {
    const lowered = String(key || "").toLowerCase();
    if (!lowered) continue;
    // eslint-disable-next-line security/detect-object-injection -- normalized header keys
    normalized[lowered] = Array.isArray(value) ? value[0] : value;
  }
  return normalized;
};

const isCopilotResponsesShape = (summary) => {
  if (!summary || !summary.has_input || !summary.input_is_array) return false;
  if (!Array.isArray(summary.input_item_types)) return false;
  if (summary.input_item_types.length === 0) return false;
  if (summary.input_item_types.length > 1 || !summary.input_item_types.includes("message")) {
    return false;
  }
  if (!summary.input_message_count || summary.input_message_count < 1) return false;
  if (summary.has_metadata || summary.has_tools || summary.has_tool_choice) return false;
  const roles = Array.isArray(summary.input_message_roles) ? summary.input_message_roles : [];
  if (roles.length === 0) return false;
  return roles.every((role) => role === "assistant" || role === "user");
};

const addReason = (collector, reason) => {
  if (!reason) return;
  if (!collector.includes(reason)) collector.push(reason);
};

export const detectCopilotRequest = ({
  headers = {},
  markers = null,
  responsesSummary = null,
} = {}) => {
  const normalized = normalizeHeaders(headers);
  const reasons = [];

  const traceHeader = normalized["x-copilot-trace-id"];
  const hasTraceHeader = isNonEmptyString(traceHeader);
  if (hasTraceHeader) addReason(reasons, "header_x_copilot_trace_id");

  const referer = normalized["http-referer"];
  const title = normalized["x-title"];
  const hasOpenRouterPair =
    referer === "https://obsidiancopilot.com" && title === "Obsidian Copilot";
  if (hasOpenRouterPair) addReason(reasons, "header_openrouter_pair");

  const recentTag = Boolean(
    markers?.has_recent_conversations_tag || responsesSummary?.has_recent_conversations_tag
  );
  if (recentTag) addReason(reasons, "marker_recent_conversations");

  const savedTag = Boolean(
    markers?.has_saved_memories_tag || responsesSummary?.has_saved_memories_tag
  );
  if (savedTag) addReason(reasons, "marker_saved_memories");

  const useToolTag = Boolean(markers?.has_use_tool_tag || responsesSummary?.has_use_tool_tag);
  if (useToolTag) addReason(reasons, "marker_use_tool");

  const toolResultTag = Boolean(
    markers?.has_tool_result_marker || responsesSummary?.has_tool_result_marker
  );
  if (toolResultTag) addReason(reasons, "marker_tool_result");

  const ua = String(normalized["user-agent"] || "");
  const uaLower = ua.toLowerCase();
  const uaIsObsidian = uaLower.includes("obsidian/");
  const uaIsUnjs = uaLower.startsWith("un/js");
  if (uaIsObsidian) addReason(reasons, "ua_obsidian");
  if (uaIsUnjs) addReason(reasons, "ua_unjs");

  const shapeMatch = responsesSummary ? isCopilotResponsesShape(responsesSummary) : false;
  if (shapeMatch) addReason(reasons, "shape_responses_basic");

  const highConfidence = hasTraceHeader || hasOpenRouterPair || recentTag || savedTag;
  const suspected =
    !highConfidence && (uaIsObsidian || uaIsUnjs) && (useToolTag || toolResultTag || shapeMatch);

  const tier = highConfidence ? "high" : suspected ? "suspected" : null;
  return {
    copilot_detected: Boolean(tier),
    copilot_detect_tier: tier,
    copilot_detect_reasons: reasons.slice(0, 6),
  };
};
