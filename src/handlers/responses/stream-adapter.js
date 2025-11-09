import { nanoid } from "nanoid";
import { normalizeResponseId, convertChatResponseToResponses } from "./shared.js";
import { createToolCallAggregator } from "../../lib/tool-call-aggregator.js";

const DEFAULT_ROLE = "assistant";
const OUTPUT_DELTA_EVENT = "response.output_text.delta";

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

const normalizeToolType = (value) => {
  if (typeof value === "string" && value) {
    const lower = value.toLowerCase();
    if (lower === "function") return "function_call";
    return value;
  }
  return "function_call";
};

export function createResponsesStreamAdapter(res, requestBody = {}) {
  const toolCallAggregator = createToolCallAggregator();
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
        finishReason: null,
        toolCalls: new Map(),
      });
    }
    return choiceStates.get(index);
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

  const emitToolCallDeltas = (choiceState, index, deltas = []) => {
    if (!choiceState || !Array.isArray(deltas) || deltas.length === 0) return;
    const responseId = state.responseId;
    deltas.forEach((toolDelta) => {
      if (!toolDelta) return;
      const ordinal = Number.isInteger(toolDelta.index)
        ? toolDelta.index
        : choiceState.toolCalls.size;
      const callId = toolDelta.id || `tool_${index}_${ordinal}`;
      const existing = choiceState.toolCalls.get(callId) || {
        id: callId,
        ordinal,
        type: normalizeToolType(toolDelta.type),
        name: toolDelta.function?.name || callId,
        lastArgs: "",
        added: false,
        doneArguments: false,
        outputDone: false,
      };

      if (toolDelta.type) existing.type = normalizeToolType(toolDelta.type);
      if (toolDelta.function?.name) existing.name = toolDelta.function.name;

      if (!existing.added) {
        writeEvent("response.output_item.added", {
          type: "response.output_item.added",
          response_id: responseId,
          output_index: index,
          item: {
            id: existing.id,
            type: existing.type,
            name: existing.name,
            status: "in_progress",
          },
        });
        existing.added = true;
      }

      if (typeof toolDelta.function?.arguments === "string") {
        const incoming = toolDelta.function.arguments;
        const previous = existing.lastArgs || "";
        const chunk = incoming.slice(previous.length);
        if (chunk) {
          writeEvent("response.function_call_arguments.delta", {
            type: "response.function_call_arguments.delta",
            response_id: responseId,
            output_index: index,
            item_id: existing.id,
            delta: chunk,
          });
          existing.lastArgs = incoming;
        }
      }

      choiceState.toolCalls.set(existing.id, existing);
    });
  };

  const finalizeToolCalls = (choiceState, index, snapshot = []) => {
    if (!choiceState || !Array.isArray(snapshot) || snapshot.length === 0) return;
    const responseId = state.responseId;
    snapshot.forEach((call, ordinal) => {
      if (!call) return;
      const callId = call.id || `tool_${index}_${ordinal}`;
      const existing = choiceState.toolCalls.get(callId) || {
        id: callId,
        ordinal,
        type: normalizeToolType(call.type),
        name: call.function?.name || callId,
        lastArgs: "",
        added: false,
        doneArguments: false,
        outputDone: false,
      };

      existing.type = normalizeToolType(call.type);
      if (call.function?.name) existing.name = call.function.name;

      if (!existing.added) {
        writeEvent("response.output_item.added", {
          type: "response.output_item.added",
          response_id: responseId,
          output_index: index,
          item: {
            id: existing.id,
            type: existing.type,
            name: existing.name,
            status: "in_progress",
          },
        });
        existing.added = true;
      }

      const argumentsText = call.function?.arguments ?? "";
      if (argumentsText && argumentsText !== existing.lastArgs) {
        const previous = existing.lastArgs || "";
        const chunk = argumentsText.slice(previous.length);
        if (chunk) {
          writeEvent("response.function_call_arguments.delta", {
            type: "response.function_call_arguments.delta",
            response_id: responseId,
            output_index: index,
            item_id: existing.id,
            delta: chunk,
          });
        }
        existing.lastArgs = argumentsText;
      }

      if (!existing.doneArguments) {
        writeEvent("response.function_call_arguments.done", {
          type: "response.function_call_arguments.done",
          response_id: responseId,
          output_index: index,
          item_id: existing.id,
          arguments: argumentsText,
        });
        existing.doneArguments = true;
      }

      if (!existing.outputDone) {
        writeEvent("response.output_item.done", {
          type: "response.output_item.done",
          response_id: responseId,
          output_index: index,
          item: {
            id: existing.id,
            type: existing.type,
            name: existing.name,
            arguments: argumentsText,
            status: "completed",
          },
        });
        existing.outputDone = true;
      }

      choiceState.toolCalls.set(existing.id, existing);
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

      let deltaUpdated = false;
      if (delta && typeof delta === "object") {
        const result = toolCallAggregator.ingestDelta(delta, { choiceIndex: index });
        deltaUpdated = Boolean(result?.updated);
        if (deltaUpdated) {
          ensureCreated();
          emitToolCallDeltas(choiceState, index, result?.deltas);
        }
      }

      if (!deltaUpdated && choice.message && typeof choice.message === "object") {
        // Some upstream workers send a final aggregated message payload within the streaming
        // channel instead of emitting deltas for each tool call. When the delta ingestion above
        // didn't update the aggregator, fall back to the message payload so we still surface
        // tool_calls in the completion snapshot.
        const messageResult = toolCallAggregator.ingestMessage(choice.message, {
          choiceIndex: index,
          emitIfMissing: true,
        });
        if (messageResult?.updated) {
          ensureCreated();
          emitToolCallDeltas(choiceState, index, messageResult.deltas);
        }
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
          finishReason: "stop",
          toolCalls: new Map(),
        });
      }

      const chatChoices = indices.map((index) => {
        const choiceState = choiceStates.get(index);
        const text = choiceState?.textParts.join("") || "";
        const snapshot = toolCallAggregator.snapshot({ choiceIndex: index });
        finalizeToolCalls(choiceState, index, snapshot);
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
