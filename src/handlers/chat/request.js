import { invalidRequestBody } from "../../lib/errors.js";

class ChatJsonRpcNormalizationError extends Error {
  constructor(body, statusCode = 400) {
    super("Chat request normalization failed");
    this.name = "ChatJsonRpcNormalizationError";
    this.statusCode = statusCode;
    this.body = body;
  }
}

const toFiniteNumber = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  const num = Number(value);
  if (!Number.isFinite(num)) return undefined;
  return num;
};

const toPositiveInteger = (value) => {
  const num = toFiniteNumber(value);
  if (num === undefined) return undefined;
  if (!Number.isInteger(num) || num <= 0) return undefined;
  return num;
};

const normalizeUser = (value) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, 256);
};

const summarizeMessages = (messages = []) => {
  const summary = {
    message_count: 0,
    system_count: 0,
    user_count: 0,
    assistant_count: 0,
  };
  if (!Array.isArray(messages)) return summary;
  summary.message_count = messages.length;
  for (const msg of messages) {
    const role = (msg?.role || "").toLowerCase();
    if (role === "system") summary.system_count += 1;
    else if (role === "user") summary.user_count += 1;
    else if (role === "assistant") summary.assistant_count += 1;
  }
  return summary;
};

const normalizeToolChoice = (rawChoice) => {
  if (rawChoice === undefined || rawChoice === null) return undefined;
  if (typeof rawChoice === "string") {
    const trimmed = rawChoice.trim();
    if (!trimmed) return undefined;
    return trimmed;
  }
  if (typeof rawChoice === "object") return rawChoice;
  return undefined;
};

const normalizeParallelToolCalls = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return undefined;
    if (["true", "1", "yes"].includes(trimmed)) return true;
    if (["false", "0", "no"].includes(trimmed)) return false;
  }
  return undefined;
};

const validateTools = (tools) => {
  if (tools === undefined || tools === null) return undefined;
  if (!Array.isArray(tools)) {
    throw new ChatJsonRpcNormalizationError(
      invalidRequestBody("tools", "tools must be an array of definitions")
    );
  }
  const definitions = [];
  for (const [idx, tool] of tools.entries()) {
    if (!tool || typeof tool !== "object") {
      throw new ChatJsonRpcNormalizationError(
        invalidRequestBody(
          `tools[${idx}]`,
          'tool definition must be an object with type "function"'
        )
      );
    }
    const type = String(tool.type || "").toLowerCase();
    if (type !== "function") {
      throw new ChatJsonRpcNormalizationError(
        invalidRequestBody(`tools[${idx}].type`, 'tool type must be "function"')
      );
    }
    const fn = tool.function || tool.fn;
    if (!fn || typeof fn !== "object" || !fn.name || !String(fn.name).trim()) {
      throw new ChatJsonRpcNormalizationError(
        invalidRequestBody(
          `tools[${idx}].function.name`,
          'function definitions must include a non-empty "name"'
        )
      );
    }
    definitions.push(tool);
  }
  return definitions.length ? definitions : undefined;
};

const buildSharedMetadata = ({
  reqId,
  requestedModel,
  effectiveModel,
  choiceCount,
  stream,
  user,
  reasoningEffort,
  temperature,
  topP,
  maxOutputTokens,
  tools,
  toolChoice,
  parallelToolCalls,
  messages,
}) => {
  const meta = {
    route: "/v1/chat/completions",
    req_id: reqId,
    requested_model: requestedModel,
    effective_model: effectiveModel,
    stream: !!stream,
    n: choiceCount,
  };

  if (user) meta.user = user;
  if (reasoningEffort) meta.reasoning_effort = reasoningEffort;
  if (temperature !== undefined) meta.temperature = temperature;
  if (topP !== undefined) meta.top_p = topP;
  if (maxOutputTokens !== undefined) meta.max_output_tokens = maxOutputTokens;
  if (Array.isArray(tools)) meta.tool_count = tools.length;
  if (toolChoice !== undefined) meta.tool_choice = toolChoice;
  if (parallelToolCalls !== undefined) meta.parallel_tool_calls = parallelToolCalls;

  const summary = summarizeMessages(messages);
  meta.message_count = summary.message_count;
  meta.system_count = summary.system_count;
  meta.user_count = summary.user_count;
  meta.assistant_count = summary.assistant_count;

  return meta;
};

export const normalizeChatJsonRpcRequest = ({
  body = {},
  messages = [],
  prompt = "",
  reqId,
  requestedModel,
  effectiveModel,
  choiceCount = 1,
  stream = false,
  reasoningEffort = "",
  sandboxMode = "",
  codexWorkdir = "",
  approvalMode = "",
}) => {
  const temperature = toFiniteNumber(body.temperature);
  if (body.temperature !== undefined && temperature === undefined) {
    throw new ChatJsonRpcNormalizationError(
      invalidRequestBody("temperature", "temperature must be a finite number between 0 and 2")
    );
  }
  if (temperature !== undefined && (temperature < 0 || temperature > 2)) {
    throw new ChatJsonRpcNormalizationError(
      invalidRequestBody("temperature", "temperature must be between 0 and 2")
    );
  }

  const topP = toFiniteNumber(body.top_p);
  if (body.top_p !== undefined && topP === undefined) {
    throw new ChatJsonRpcNormalizationError(
      invalidRequestBody("top_p", "top_p must be a finite number between 0 and 1")
    );
  }
  if (topP !== undefined && (topP <= 0 || topP > 1)) {
    throw new ChatJsonRpcNormalizationError(
      invalidRequestBody("top_p", "top_p must be greater than 0 and at most 1")
    );
  }

  const maxOutputTokens = toPositiveInteger(
    body.max_tokens ?? body.max_completion_tokens ?? body.maxOutputTokens
  );
  if (
    (body.max_tokens !== undefined ||
      body.max_completion_tokens !== undefined ||
      body.maxOutputTokens !== undefined) &&
    maxOutputTokens === undefined
  ) {
    throw new ChatJsonRpcNormalizationError(
      invalidRequestBody("max_tokens", "max_tokens must be a positive integer")
    );
  }

  const definitions = validateTools(body.tools);
  const toolChoice = normalizeToolChoice(body.tool_choice ?? body.toolChoice);
  const parallelToolCalls = normalizeParallelToolCalls(body.parallel_tool_calls);
  if (
    body.parallel_tool_calls !== undefined &&
    parallelToolCalls === undefined &&
    body.parallel_tool_calls !== null
  ) {
    throw new ChatJsonRpcNormalizationError(
      invalidRequestBody(
        "parallel_tool_calls",
        "parallel_tool_calls must be a boolean when provided"
      )
    );
  }

  const toolsPayload = (() => {
    const payload = {};
    if (definitions) payload.definitions = definitions;
    if (toolChoice !== undefined) payload.choice = toolChoice;
    if (parallelToolCalls !== undefined) payload.parallel_tool_calls = parallelToolCalls;
    return Object.keys(payload).length ? payload : undefined;
  })();

  const streamOptionsIncludeUsage = (() => {
    const raw = body.stream_options?.include_usage;
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "string") {
      const trimmed = raw.trim().toLowerCase();
      if (["true", "1", "yes"].includes(trimmed)) return true;
      if (["false", "0", "no"].includes(trimmed)) return false;
    }
    throw new ChatJsonRpcNormalizationError(
      invalidRequestBody(
        "stream_options.include_usage",
        "include_usage must be a boolean when provided"
      )
    );
  })();

  const bodyIncludeUsage = (() => {
    const raw = body.include_usage ?? body.includeUsage;
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "string") {
      const trimmed = raw.trim().toLowerCase();
      if (["true", "1", "yes"].includes(trimmed)) return true;
      if (["false", "0", "no"].includes(trimmed)) return false;
    }
    throw new ChatJsonRpcNormalizationError(
      invalidRequestBody("include_usage", "include_usage must be a boolean when provided")
    );
  })();

  const includeUsage = streamOptionsIncludeUsage ?? bodyIncludeUsage ?? true;
  const user = normalizeUser(body.user);

  const sharedMetadata = buildSharedMetadata({
    reqId,
    requestedModel,
    effectiveModel,
    choiceCount,
    stream,
    user,
    reasoningEffort,
    temperature,
    topP,
    maxOutputTokens,
    tools: definitions,
    toolChoice,
    parallelToolCalls,
    messages,
  });

  const turn = {
    metadata: { ...sharedMetadata },
    model: effectiveModel,
    stream: !!stream,
    choice_count: choiceCount,
  };

  if (sandboxMode) {
    turn.sandbox_policy = { mode: sandboxMode };
  }

  if (approvalMode) {
    turn.approval_policy = { mode: approvalMode };
  }

  if (codexWorkdir) {
    turn.cwd = codexWorkdir;
  }

  if (reasoningEffort) {
    turn.reasoning = { effort: reasoningEffort };
  }

  if (user) {
    turn.user = user;
  }

  const message = {
    text: typeof prompt === "string" ? prompt : String(prompt ?? ""),
    stream: !!stream,
    include_usage: includeUsage,
    metadata: { ...sharedMetadata },
  };

  if (temperature !== undefined) message.temperature = temperature;
  if (topP !== undefined) message.top_p = topP;
  if (maxOutputTokens !== undefined) message.max_output_tokens = maxOutputTokens;
  if (toolsPayload) {
    message.tools = { ...toolsPayload };
    turn.tools = { ...toolsPayload };
  }
  if (body.response_format !== undefined) message.response_format = body.response_format;

  return { turn, message };
};

export { ChatJsonRpcNormalizationError };
