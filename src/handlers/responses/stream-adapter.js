import { nanoid } from "nanoid";
import { normalizeResponseId, convertChatResponseToResponses } from "./shared.js";
import { createToolCallAggregator } from "../../lib/tool-call-aggregator.js";
import { recordResponsesSseEvent } from "../../services/metrics/index.js";
import { appendProtoEvent, LOG_PROTO } from "../../dev-logging.js";
import { ensureReqId } from "../../lib/request-context.js";
import { logStructured, sha256, shouldLogVerbose, preview } from "../../services/logging/schema.js";

const DEFAULT_ROLE = "assistant";
const OUTPUT_DELTA_EVENT = "response.output_text.delta";
const RESPONSES_ROUTE = "/v1/responses";
const RESPONSE_SHAPE_VERSION = "responses_v0_typed_sse_openai_json";

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

const getDeltaBytes = (payload) => {
  if (!payload || typeof payload !== "object") return null;
  const delta =
    typeof payload.delta === "string"
      ? payload.delta
      : typeof payload.arguments === "string"
        ? payload.arguments
        : null;
  return delta ? Buffer.byteLength(delta, "utf8") : null;
};

export function createResponsesStreamAdapter(res, requestBody = {}) {
  const toolCallAggregator = createToolCallAggregator();
  const choiceStates = new Map();
  const eventCounts = new Map();
  const state = {
    responseId: null,
    chatCompletionId: null,
    model: null,
    finishReasons: new Set(),
    status: "completed",
    usage: null,
    createdEmitted: false,
    finished: false,
    eventSeq: 0,
  };

  const recordEvent = (event) => {
    eventCounts.set(event, (eventCounts.get(event) || 0) + 1);
    recordResponsesSseEvent({
      route: res.locals?.routeOverride || RESPONSES_ROUTE,
      model: state.model || requestBody?.model,
      event,
    });
  };

  const logEventSummary = (outcome, extra = {}) => {
    try {
      const events = Object.fromEntries(
        Array.from(eventCounts.entries()).sort(([a], [b]) => a.localeCompare(b))
      );
      const prev = requestBody?.previous_response_id;
      const usage = state.usage;
      logStructured(
        {
          component: "responses",
          event: "sse_summary",
          level: outcome === "failed" ? "error" : "debug",
          req_id: res.locals?.req_id,
          trace_id: res.locals?.trace_id,
          route: res.locals?.routeOverride || RESPONSES_ROUTE,
          mode: res.locals?.modeOverride || res.locals?.mode,
          model: state.model || requestBody?.model,
          response_id: state.responseId,
          status: state.status,
        },
        {
          endpoint_mode: res.locals?.endpoint_mode || "responses",
          copilot_trace_id: res.locals?.copilot_trace_id || null,
          outcome,
          events,
          finish_reasons: Array.from(state.finishReasons),
          usage_input_tokens: usage?.prompt_tokens ?? null,
          usage_output_tokens: usage?.completion_tokens ?? null,
          usage_total_tokens: usage?.total_tokens ?? null,
          previous_response_id_hash: prev ? sha256(prev) : null,
          output_mode_effective: res.locals?.output_mode_effective ?? null,
          response_shape_version: RESPONSE_SHAPE_VERSION,
          ...extra,
        }
      );
    } catch {
      // Logging failures are non-critical; swallow to avoid impacting callers.
    }
  };

  const writeEvent = (event, payload) => {
    if (res.writableEnded) return;
    try {
      state.eventSeq += 1;
      const data = event === "done" && payload === "[DONE]" ? "[DONE]" : JSON.stringify(payload);
      if (LOG_PROTO) {
        const reqId = ensureReqId(res);
        const deltaBytes = getDeltaBytes(payload);
        const verbose = shouldLogVerbose();

        const debugExtras = {};
        if (verbose && event === OUTPUT_DELTA_EVENT && typeof payload?.delta === "string") {
          const sample = preview(payload.delta, 160);
          debugExtras.delta_preview = sample.preview;
          debugExtras.content_truncated = sample.truncated;
          debugExtras.content_preview_len = sample.preview.length;
        }

        appendProtoEvent({
          phase: "responses_sse_out",
          req_id: reqId,
          route: res.locals?.routeOverride || RESPONSES_ROUTE,
          mode: res.locals?.modeOverride || res.locals?.mode || "responses_stream",
          endpoint_mode: res.locals?.endpoint_mode || "responses",
          copilot_trace_id: res.locals?.copilot_trace_id || null,
          trace_id: res.locals?.trace_id || null,
          stream: true,
          stream_protocol: "sse",
          stream_event_seq: state.eventSeq,
          stream_event_type: event,
          delta_bytes: deltaBytes,
          event_bytes: Buffer.byteLength(data, "utf8"),
          response_shape_version: RESPONSE_SHAPE_VERSION,
          ...debugExtras,
        });
      }
      res.write(`event: ${event}\ndata: ${data}\n\n`);
      recordEvent(event);
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
        toolCallOrdinals: new Map(),
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

  const ensureToolCallTracking = (choiceState) => {
    if (!choiceState.toolCalls) {
      choiceState.toolCalls = new Map();
    }
    if (!choiceState.toolCallOrdinals) {
      choiceState.toolCallOrdinals = new Map();
    }
    return {
      toolCalls: choiceState.toolCalls,
      ordinals: choiceState.toolCallOrdinals,
    };
  };

  const resolveToolCallState = (choiceState, index, { id, ordinal, fallbackId, type, name }) => {
    const { toolCalls, ordinals } = ensureToolCallTracking(choiceState);

    let existing = null;
    if (id && toolCalls.has(id)) {
      existing = toolCalls.get(id);
    }

    if (!existing && Number.isInteger(ordinal)) {
      const priorId = ordinals.get(ordinal);
      if (priorId && toolCalls.has(priorId)) {
        existing = toolCalls.get(priorId);
      }
    }

    if (!existing && fallbackId && toolCalls.has(fallbackId)) {
      existing = toolCalls.get(fallbackId);
    }

    if (!existing) {
      const resolvedOrdinal = Number.isInteger(ordinal) ? ordinal : toolCalls.size;
      existing = {
        id: fallbackId || id || `tool_${index}_${resolvedOrdinal}`,
        ordinal: resolvedOrdinal,
        type: normalizeToolType(type),
        name: name || fallbackId || id || `tool_${index}_${resolvedOrdinal}`,
        lastArgs: "",
        added: false,
        doneArguments: false,
        outputDone: false,
      };
    }

    if (Number.isInteger(ordinal) && existing.ordinal !== ordinal) {
      existing.ordinal = ordinal;
    }

    const resolvedId = id || existing.id;
    if (resolvedId !== existing.id) {
      toolCalls.delete(existing.id);
      existing.id = resolvedId;
    }

    if (type) existing.type = normalizeToolType(type);
    if (name) existing.name = name;

    toolCalls.set(existing.id, existing);
    if (Number.isInteger(existing.ordinal)) {
      ordinals.set(existing.ordinal, existing.id);
    }

    return existing;
  };

  const emitToolCallDeltas = (choiceState, index, deltas = []) => {
    if (!choiceState || !Array.isArray(deltas) || deltas.length === 0) return;
    const responseId = state.responseId;
    const { toolCalls } = ensureToolCallTracking(choiceState);
    deltas.forEach((toolDelta) => {
      if (!toolDelta) return;
      const ordinal = Number.isInteger(toolDelta.index) ? toolDelta.index : null;
      const fallbackOrdinal = ordinal ?? toolCalls.size;
      const fallbackId = toolDelta.id || `tool_${index}_${fallbackOrdinal}`;
      const existing = resolveToolCallState(choiceState, index, {
        id: toolDelta.id,
        ordinal,
        fallbackId,
        type: toolDelta.type,
        name: toolDelta.function?.name,
      });

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
        const chunk =
          incoming.length >= previous.length ? incoming.slice(previous.length) : incoming;
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
    });
  };

  const finalizeToolCalls = (choiceState, index, snapshot = []) => {
    if (!choiceState || !Array.isArray(snapshot) || snapshot.length === 0) return;
    const responseId = state.responseId;
    snapshot.forEach((call, ordinal) => {
      if (!call) return;
      const fallbackId = call.id || `tool_${index}_${ordinal}`;
      const existing = resolveToolCallState(choiceState, index, {
        id: call.id,
        ordinal,
        fallbackId,
        type: call.type,
        name: call.function?.name,
      });

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
        if (LOG_PROTO) {
          const args = argumentsText || "";
          const argsBytes = Buffer.byteLength(args, "utf8");
          let jsonValid = false;
          try {
            JSON.parse(args);
            jsonValid = true;
          } catch {
            jsonValid = false;
          }

          const debugExtras = {};
          if (shouldLogVerbose() && args && !jsonValid) {
            const sample = preview(args, 160);
            debugExtras.args_preview = sample.preview;
            debugExtras.content_truncated = sample.truncated;
            debugExtras.content_preview_len = sample.preview.length;
          }

          appendProtoEvent({
            phase: "tool_call_arguments_done",
            endpoint_mode: res.locals?.endpoint_mode || "responses",
            req_id: res.locals?.req_id || ensureReqId(res),
            copilot_trace_id: res.locals?.copilot_trace_id || null,
            trace_id: res.locals?.trace_id || null,
            route: res.locals?.routeOverride || RESPONSES_ROUTE,
            mode: res.locals?.modeOverride || res.locals?.mode || "responses_stream",
            tool_call_id: existing.id,
            tool_name: existing.name,
            tool_args_bytes: argsBytes,
            tool_args_json_valid: jsonValid,
            response_shape_version: RESPONSE_SHAPE_VERSION,
            ...debugExtras,
          });
        }

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
    res.locals = res.locals || {};
    res.locals.adapter_failed_emitted = true;
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
    logEventSummary("failed", { message });
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
          toolCallOrdinals: new Map(),
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
      logEventSummary("completed", { finish_reasons: Array.from(state.finishReasons) });
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
