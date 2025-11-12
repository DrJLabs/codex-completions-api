import { invalidRequestBody } from "../../lib/errors.js";
import { createUserMessageItem } from "../../lib/json-rpc/schema.ts";

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

const flattenMessageContent = (content) => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (!part || typeof part !== "object") return "";
        if (typeof part.text === "string") return part.text;
        if (typeof part.content === "string") return part.content;
        if (part.type === "text" && typeof part.text === "string") return part.text;
        if (part.type === "image_url") {
          const url =
            typeof part.image_url === "string" ? part.image_url : (part.image_url?.url ?? "");
          return url ? `[image:${url}]` : "";
        }
        if (part.type === "input_text" && typeof part.input_text === "string") {
          return part.input_text;
        }
        try {
          return JSON.stringify(part);
        } catch {
          return String(part ?? "");
        }
      })
      .join("");
  }
  if (content && typeof content === "object") {
    if (typeof content.text === "string") return content.text;
    if (Array.isArray(content.content)) return flattenMessageContent(content.content);
  }
  if (content === null || content === undefined) return "";
  return String(content);
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

const resolveFinalOutputJsonSchema = (responseFormat) => {
  if (!responseFormat || typeof responseFormat !== "object") return undefined;
  const type = String(responseFormat.type || "").toLowerCase();
  if (type !== "json_schema") return undefined;
  const schemaObject = responseFormat.json_schema ?? responseFormat.schema;
  if (schemaObject === null) return null;
  if (schemaObject && typeof schemaObject === "object") {
    if (schemaObject.schema && typeof schemaObject.schema === "object") {
      return schemaObject.schema;
    }
    return schemaObject;
  }
  return undefined;
};

const buildToolsPayload = ({ definitions, toolChoice, parallelToolCalls }) => {
  const payload = {};
  if (definitions) payload.definitions = definitions;
  if (toolChoice !== undefined) payload.choice = toolChoice;
  if (parallelToolCalls !== undefined) payload.parallelToolCalls = parallelToolCalls;
  return Object.keys(payload).length ? payload : undefined;
};

export const normalizeChatJsonRpcRequest = ({
  body = {},
  messages = [],
  prompt = "",
  reqId: _reqId,
  requestedModel: _requestedModel,
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

  // Always request usage metrics from app-server. Downstream finish-reason
  // reconciliation depends on usage events even when a client opts out.
  const includeUsage = true;

  const promptText = typeof prompt === "string" ? prompt : String(prompt ?? "");

  const systemInstructions = (messages || [])
    .filter((msg) => (msg?.role || "").toLowerCase() === "system")
    .map((msg) => flattenMessageContent(msg?.content).trim())
    .filter(Boolean);

  const baseInstructions = systemInstructions.length ? systemInstructions.join("\n\n") : undefined;

  const userItems = (messages || [])
    .filter((msg) => (msg?.role || "").toLowerCase() === "user")
    .map((msg) => flattenMessageContent(msg?.content).trim())
    .filter(Boolean)
    .map((text) => createUserMessageItem(text));

  const fallbackText = flattenMessageContent(promptText).trim() || promptText || "";
  const turnItems = userItems.length ? userItems : [createUserMessageItem(fallbackText)];
  const messageItems = turnItems.map((item) => ({ ...item }));
  const finalOutputJsonSchema = resolveFinalOutputJsonSchema(body.response_format);
  const toolsPayload = buildToolsPayload({
    definitions,
    toolChoice,
    parallelToolCalls,
  });

  const turn = {
    model: effectiveModel,
    items: turnItems,
    cwd: codexWorkdir,
    approvalPolicy: approvalMode,
    sandboxPolicy: sandboxMode ? { mode: sandboxMode } : undefined,
    effort: reasoningEffort || null,
    summary: "auto",
    stream: !!stream,
    choiceCount,
    includeApplyPatchTool: true,
  };

  if (baseInstructions) {
    turn.baseInstructions = baseInstructions;
  }

  if (toolsPayload) {
    turn.tools = toolsPayload;
  }

  if (finalOutputJsonSchema !== undefined) {
    turn.finalOutputJsonSchema = finalOutputJsonSchema;
  }

  const messagePayload = {
    items: messageItems,
    includeUsage,
  };

  if (temperature !== undefined) messagePayload.temperature = temperature;
  if (topP !== undefined) messagePayload.topP = topP;
  if (maxOutputTokens !== undefined) messagePayload.maxOutputTokens = maxOutputTokens;
  if (toolsPayload) {
    messagePayload.tools = toolsPayload;
  }
  if (body.response_format !== undefined) {
    messagePayload.responseFormat = body.response_format;
  }
  if (reasoningEffort) {
    messagePayload.reasoning = { effort: reasoningEffort };
  }
  if (finalOutputJsonSchema !== undefined) {
    messagePayload.finalOutputJsonSchema = finalOutputJsonSchema;
  }

  return { turn, message: messagePayload };
};

export { ChatJsonRpcNormalizationError };
