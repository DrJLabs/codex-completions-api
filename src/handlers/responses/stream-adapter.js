import { nanoid } from "nanoid";
import { normalizeResponseId, convertChatResponseToResponses } from "./shared.js";

const DEFAULT_ROLE = "assistant";
const OUTPUT_DELTA_EVENT = "response.output_text.delta";
const DEFAULT_TOOL_TYPE = "function";

const normalizeToolCallArguments = (value) => (typeof value === "string" ? value : "");

const toNumericIndex = (value) => {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isInteger(parsed)) return parsed;
  }
  return null;
};

const mapFinishStatus = (reasons) => {
  const normalized = new Set(
    (Array.isArray(reasons) ? reasons : [reasons])
      .filter(Boolean)
      .map((reason) => String(reason).toLowerCase())
  );

  if (
    normalized.has("failed") ||
    normalized.has("error") ||
    normalized.has("cancelled") ||
    normalized.has("canceled")
  ) {
    return "failed";
  }

  if (normalized.has("length") || normalized.has("content_filter")) {
    return "incomplete";
  }

  if (normalized.size === 0) return "completed";
  return "completed";
};

const isNonEmptyString = (value) => typeof value === "string" && value.length > 0;

export function createResponsesStreamAdapter(res, requestBody = {}) {
  const choiceStates = new Map();
  const state = {
    responseId: null,
    chatCompletionId: null,
    model: null,
    finishReasons: new Set(),
    status: "completed",
    usage: null,
    createdEmitted: false,
    finished: false,
  };

  const writeEvent = (event, payload) => {
    if (res.writableEnded) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch (error) {
      console.error("[proxy][responses.stream-adapter] failed to write SSE event", error);
    }
  };

  const ensureCreated = () => {
    if (state.createdEmitted) return;
    if (!state.responseId) {
      const baseId = state.chatCompletionId || `chatcmpl-${nanoid()}`;
      state.responseId = normalizeResponseId(baseId);
    }
    state.createdEmitted = true;
    writeEvent("response.created", {
      type: "response.created",
      response: {
        id: state.responseId,
        status: "in_progress",
      },
    });
  };

  const ensureChoiceState = (index) => {
    if (!choiceStates.has(index)) {
      choiceStates.set(index, {
        index,
        role: DEFAULT_ROLE,
        textParts: [],
        toolCalls: new Map(),
        toolCallOrder: [],
        toolCallAliases: new Map(),
        nextToolOrdinal: 0,
        finishReason: null,
      });
    }
    return choiceStates.get(index);
  };

  const registerToolAlias = (choiceState, type, value, key) => {
    if (value === undefined || value === null || value === "") return;
    choiceState.toolCallAliases.set(`${type}:${value}`, key);
  };

  const upsertToolCall = (choiceState, call = {}) => {
    if (!choiceState || !call || typeof call !== "object") return;
    const trimmedId = typeof call.id === "string" && call.id.trim() ? call.id.trim() : null;
    const numericIndex = toNumericIndex(call.index);
    let key = null;
    if (trimmedId) {
      key = choiceState.toolCallAliases.get(`id:${trimmedId}`) || null;
    }
    if (!key && numericIndex !== null) {
      key = choiceState.toolCallAliases.get(`idx:${numericIndex}`) || null;
    }
    if (!key) {
      key = trimmedId
        ? `id:${trimmedId}`
        : numericIndex !== null
          ? `idx:${numericIndex}`
          : `auto:${choiceState.nextToolOrdinal}`;
    }

    if (!choiceState.toolCallOrder.includes(key)) {
      choiceState.toolCallOrder.push(key);
      if (!trimmedId && numericIndex === null) {
        choiceState.nextToolOrdinal += 1;
      }
    }

    const existing = choiceState.toolCalls.get(key) || {
      id:
        trimmedId ||
        `tool_${choiceState.index}_${choiceState.toolCallOrder.length - 1}`,
      type: DEFAULT_TOOL_TYPE,
      function: { name: undefined, arguments: "" },
    };

    if (trimmedId) existing.id = trimmedId;
    if (typeof call.type === "string" && call.type.trim()) {
      existing.type = call.type;
    }
    const fn = call.function && typeof call.function === "object" ? call.function : null;
    if (fn?.name && typeof fn.name === "string" && fn.name.trim()) {
      existing.function.name = fn.name;
    }
    if (typeof fn?.arguments === "string") {
      existing.function.arguments = fn.arguments;
    }

    choiceState.toolCalls.set(key, existing);
    if (trimmedId) registerToolAlias(choiceState, "id", trimmedId, key);
    if (numericIndex !== null) registerToolAlias(choiceState, "idx", numericIndex, key);
  };

  const appendTextSegment = (choiceState, index, text) => {
    if (!isNonEmptyString(text)) return;
    ensureCreated();
    choiceState.textParts.push(text);
    writeEvent(OUTPUT_DELTA_EVENT, {
      type: OUTPUT_DELTA_EVENT,
      delta: text,
      output_index: index,
    });
  };

  const endStream = () => {
    if (typeof res.end === "function" && !res.writableEnded) {
      try {
        res.end();
      } catch (err) {
        console.error("[proxy][responses.stream-adapter] failed to end SSE response", err);
      }
    }
  };

  const emitFailure = (error) => {
    if (state.finished) return false;
    state.finished = true;
    ensureCreated();
    const message = error?.message || "stream adapter error";
    writeEvent("response.failed", {
      type: "response.failed",
      response: {
        id: state.responseId,
        status: "failed",
      },
      error: {
        message,
        code: "stream_adapter_error",
      },
    });
    writeEvent("done", "[DONE]");
    endStream();
    return false;
  };

  const handleChoices = (choices = []) => {
    for (const choice of choices) {
      if (!choice) continue;
      const index = Number.isInteger(choice.index) ? choice.index : 0;
      const choiceState = ensureChoiceState(index);
      const delta = choice.delta || {};


      if (delta.role) choiceState.role = delta.role;

      if (Array.isArray(delta.content)) {
        delta.content.forEach((part) => {
          if (typeof part === "string") {
            appendTextSegment(choiceState, index, part);
          } else if (part && typeof part === "object" && typeof part.text === "string") {
            appendTextSegment(choiceState, index, part.text);
          }
        });
      } else if (typeof delta.content === "string") {
        appendTextSegment(choiceState, index, delta.content);
      } else if (
        delta.content &&
        typeof delta.content === "object" &&
        typeof delta.content.text === "string"
      ) {
        appendTextSegment(choiceState, index, delta.content.text);
      }

      if (Array.isArray(delta.tool_calls) && delta.tool_calls.length) {
        delta.tool_calls.forEach((call) => upsertToolCall(choiceState, call));
      }

      if (choice.finish_reason) {
        choiceState.finishReason = choice.finish_reason;
        state.finishReasons.add(choice.finish_reason);
      }
    }

    state.status = mapFinishStatus(Array.from(state.finishReasons));
  };

  const onChunk = (chunk) => {
    try {
      if (!chunk || typeof chunk !== "object") return true;

      state.chatCompletionId = chunk.id || state.chatCompletionId || `chatcmpl-${nanoid()}`;
      if (!state.responseId) {
        state.responseId = normalizeResponseId(state.chatCompletionId);
      }
      if (chunk.model) state.model = chunk.model;

      if (!state.createdEmitted) ensureCreated();

      handleChoices(Array.isArray(chunk.choices) ? chunk.choices : []);

      if (chunk.usage && typeof chunk.usage === "object") {
        const promptTokens = chunk.usage.prompt_tokens ?? chunk.usage.input_tokens ?? 0;
        const completionTokens = chunk.usage.completion_tokens ?? chunk.usage.output_tokens ?? 0;
        const totalTokens = chunk.usage.total_tokens ?? promptTokens + completionTokens;
        state.usage = {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
        };
      }

      return true;
    } catch (error) {
      console.error("[proxy][responses.stream-adapter] onChunk error", error);
      return emitFailure(error);
    }
  };

  const onDone = () => {
    try {
      if (state.finished) return true;
      state.finished = true;
      ensureCreated();

      writeEvent("response.output_text.done", { type: "response.output_text.done" });

      const indices = Array.from(choiceStates.keys()).sort((a, b) => a - b);
      if (indices.length === 0) {
        indices.push(0);
        choiceStates.set(0, {
          index: 0,
          role: DEFAULT_ROLE,
          textParts: [],
          toolCalls: new Map(),
          toolCallOrder: [],
          nextToolOrdinal: 0,
          finishReason: "stop",
        });
      }

      const chatChoices = indices.map((index) => {
        const choiceState = choiceStates.get(index);
        const text = choiceState?.textParts.join("") || "";
        const snapshot = (choiceState?.toolCallOrder || [])
          .map((key) => choiceState.toolCalls.get(key))
          .filter(Boolean)
          .map((entry) => ({
            id: entry.id,
            type: entry.type || DEFAULT_TOOL_TYPE,
            function: {
              name: entry.function?.name,
              arguments: normalizeToolCallArguments(entry.function?.arguments),
            },
          }));
        return {
          index,
          message: {
            role: choiceState?.role || DEFAULT_ROLE,
            content: text,
            ...(snapshot.length ? { tool_calls: snapshot } : {}),
          },
          finish_reason: choiceState?.finishReason || "stop",
        };
      });

      const chatPayload = {
        id: state.chatCompletionId || `chatcmpl-${nanoid()}`,
        model: state.model,
        choices: chatChoices,
        usage: state.usage || undefined,
      };

      const responsePayload = convertChatResponseToResponses(chatPayload, requestBody);
      responsePayload.id = state.responseId || responsePayload.id;
      responsePayload.status = state.status || responsePayload.status || "completed";

      writeEvent("response.completed", {
        type: "response.completed",
        response: responsePayload,
      });
      writeEvent("done", "[DONE]");
      endStream();
      return true;
    } catch (error) {
      console.error("[proxy][responses.stream-adapter] onDone error", error);
      return emitFailure(error);
    }
  };

  return {
    onChunk,
    onDone,
  };
}
