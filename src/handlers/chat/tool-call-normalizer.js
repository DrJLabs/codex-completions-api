const defaultLegacyId = () => "tool_0_0";

const buildLegacyToolCall = (functionCall, getNextLegacyId) => {
  const id =
    functionCall && typeof functionCall.id === "string" && functionCall.id
      ? functionCall.id
      : getNextLegacyId();
  return {
    id,
    type: "function",
    function: {
      name: functionCall?.name,
      arguments: functionCall?.arguments,
    },
  };
};

export const normalizeToolCalls = (payload, { getNextLegacyId = defaultLegacyId } = {}) => {
  if (!payload || typeof payload !== "object") return payload;
  const existing = payload.tool_calls || payload.toolCalls;
  if (Array.isArray(existing) && existing.length) return payload;
  const functionCall = payload.function_call || payload.functionCall;
  if (!functionCall || typeof functionCall !== "object") return payload;
  const normalized = { ...payload };
  normalized.tool_calls = [buildLegacyToolCall(functionCall, getNextLegacyId)];
  delete normalized.function_call;
  delete normalized.functionCall;
  return normalized;
};

export const createToolCallNormalizer = () => {
  let legacyToolCallCounter = 0;
  // Stable prefix keeps legacy IDs aligned with transcript expectations.
  const getNextLegacyId = () => `tool_0_${legacyToolCallCounter++}`;
  return {
    ingestDelta(delta) {
      return normalizeToolCalls(delta, { getNextLegacyId });
    },
    ingestMessage(message) {
      return normalizeToolCalls(message, { getNextLegacyId });
    },
    finalize() {
      return null;
    },
  };
};
