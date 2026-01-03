const buildLegacyToolCall = (functionCall) => {
  const id =
    functionCall && typeof functionCall.id === "string" && functionCall.id
      ? functionCall.id
      : "tool_0_0";
  return {
    id,
    type: "function",
    function: {
      name: functionCall?.name,
      arguments: functionCall?.arguments,
    },
  };
};

export const normalizeToolCalls = (payload) => {
  if (!payload || typeof payload !== "object") return payload;
  const existing = payload.tool_calls || payload.toolCalls;
  if (Array.isArray(existing) && existing.length) return payload;
  const functionCall = payload.function_call || payload.functionCall;
  if (!functionCall || typeof functionCall !== "object") return payload;
  const normalized = { ...payload };
  normalized.tool_calls = [buildLegacyToolCall(functionCall)];
  delete normalized.function_call;
  delete normalized.functionCall;
  return normalized;
};

export const createToolCallNormalizer = (_config = {}) => ({
  ingestDelta(delta) {
    return normalizeToolCalls(delta);
  },
  ingestMessage(message) {
    return normalizeToolCalls(message);
  },
  finalize() {
    return null;
  },
});
