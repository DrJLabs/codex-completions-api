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
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
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
        role: DEFAULT_ROLE,
        textParts: [],
        toolAggregator: createToolCallAggregator(),
        finishReason: null,
      });
    }
    return choiceStates.get(index);
  };

  const appendTextSegment = (choiceState, text) => {
    if (!isNonEmptyString(text)) return;
    ensureCreated();
    choiceState.textParts.push(text);
    writeEvent(OUTPUT_DELTA_EVENT, {
      type: OUTPUT_DELTA_EVENT,
      delta: text,
    });
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
            appendTextSegment(choiceState, part);
          } else if (part && typeof part === "object" && typeof part.text === "string") {
            appendTextSegment(choiceState, part.text);
          }
        });
      } else if (typeof delta.content === "string") {
        appendTextSegment(choiceState, delta.content);
      } else if (
        delta.content &&
        typeof delta.content === "object" &&
        typeof delta.content.text === "string"
      ) {
        appendTextSegment(choiceState, delta.content.text);
      }

      if (Array.isArray(delta.tool_calls) && delta.tool_calls.length) {
        choiceState.toolAggregator.ingestDelta({ tool_calls: delta.tool_calls });
      }

      if (choice.finish_reason) {
        choiceState.finishReason = choice.finish_reason;
        state.finishReasons.add(choice.finish_reason);
      }
    }

    state.status = mapFinishStatus(Array.from(state.finishReasons));
  };

  const onChunk = (chunk) => {
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
  };

  const onDone = () => {
    if (state.finished) return true;
    state.finished = true;
    ensureCreated();

    writeEvent("response.output_text.done", { type: "response.output_text.done" });

    const indices = Array.from(choiceStates.keys()).sort((a, b) => a - b);
    if (indices.length === 0) {
      indices.push(0);
      choiceStates.set(0, {
        role: DEFAULT_ROLE,
        textParts: [],
        toolAggregator: createToolCallAggregator(),
        finishReason: "stop",
      });
    }

    const chatChoices = indices.map((index) => {
      const choiceState = choiceStates.get(index);
      const text = choiceState?.textParts.join("") || "";
      const snapshot = choiceState?.toolAggregator.snapshot() || [];
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
    if (typeof res.end === "function") {
      try {
        res.end();
      } catch {}
    }
    return true;
  };

  return {
    onChunk,
    onDone,
  };
}
