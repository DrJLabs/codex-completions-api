import { nanoid } from "nanoid";
import { normalizeResponseId, convertChatResponseToResponses } from "./shared.js";
import { createToolCallAggregator } from "../../lib/tool-call-aggregator.js";

const DEFAULT_ROLE = "assistant";
const OUTPUT_DELTA_EVENT = "response.output_text.delta";

const mapFinishStatus = (reason) => {
  if (!reason) return "completed";
  const value = String(reason).toLowerCase();
  if (value === "length" || value === "content_filter") return "incomplete";
  if (value === "failed" || value === "error" || value === "cancelled" || value === "canceled")
    return "failed";
  return "completed";
};

const isNonEmptyString = (value) => typeof value === "string" && value.length > 0;

export function createResponsesStreamAdapter(res, requestBody = {}) {
  const toolAggregator = createToolCallAggregator();
  const state = {
    responseId: null,
    model: null,
    role: DEFAULT_ROLE,
    textParts: [],
    finishReason: null,
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
    if (!state.responseId) state.responseId = normalizeResponseId();
    state.createdEmitted = true;
    writeEvent("response.created", {
      type: "response.created",
      response: {
        id: state.responseId,
        status: "in_progress",
      },
    });
  };

  const appendText = (text) => {
    if (!isNonEmptyString(text)) return;
    ensureCreated();
    state.textParts.push(text);
    writeEvent(OUTPUT_DELTA_EVENT, {
      type: OUTPUT_DELTA_EVENT,
      delta: text,
    });
  };

  const ingestToolCalls = (delta) => {
    if (!delta) return;
    toolAggregator.ingestDelta({ tool_calls: delta });
  };

  const handleChoices = (choices = []) => {
    for (const choice of choices) {
      if (!choice) continue;
      const delta = choice.delta || {};
      if (delta.role) state.role = delta.role;

      if (Array.isArray(delta.content)) {
        delta.content.forEach((part) => {
          if (typeof part === "string") appendText(part);
          else if (part && typeof part === "object" && typeof part.text === "string") {
            appendText(part.text);
          }
        });
      } else if (typeof delta.content === "string") {
        appendText(delta.content);
      } else if (
        delta.content &&
        typeof delta.content === "object" &&
        typeof delta.content.text === "string"
      ) {
        appendText(delta.content.text);
      }

      if (Array.isArray(delta.tool_calls) && delta.tool_calls.length) {
        ingestToolCalls(delta.tool_calls);
      }

      if (choice.finish_reason) {
        state.finishReason = choice.finish_reason;
        state.status = mapFinishStatus(choice.finish_reason);
      }
    }
  };

  const onChunk = (chunk) => {
    if (!chunk || typeof chunk !== "object") return true;
    state.responseId = normalizeResponseId(chunk.id || state.responseId || `chatcmpl-${nanoid()}`);
    if (chunk.model) state.model = chunk.model;

    if (!state.createdEmitted) ensureCreated();

    handleChoices(Array.isArray(chunk.choices) ? chunk.choices : []);

    if (chunk.usage && typeof chunk.usage === "object") {
      state.usage = {
        prompt_tokens: chunk.usage.prompt_tokens ?? chunk.usage.input_tokens ?? 0,
        completion_tokens: chunk.usage.completion_tokens ?? chunk.usage.output_tokens ?? 0,
        total_tokens:
          chunk.usage.total_tokens ??
          (chunk.usage.prompt_tokens ?? chunk.usage.input_tokens ?? 0) +
            (chunk.usage.completion_tokens ?? chunk.usage.output_tokens ?? 0),
      };
    }

    return true;
  };

  const onDone = () => {
    if (state.finished) return true;
    state.finished = true;
    ensureCreated();

    writeEvent("response.output_text.done", { type: "response.output_text.done" });

    const snapshot = toolAggregator.snapshot();
    const chatPayload = {
      id: state.responseId,
      model: state.model,
      choices: [
        {
          index: 0,
          message: {
            role: state.role || DEFAULT_ROLE,
            content: state.textParts.join("") || "",
            ...(snapshot.length ? { tool_calls: snapshot } : {}),
          },
          finish_reason: state.finishReason || "stop",
        },
      ],
      usage: state.usage || undefined,
    };

    const responsePayload = convertChatResponseToResponses(chatPayload, requestBody);
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
