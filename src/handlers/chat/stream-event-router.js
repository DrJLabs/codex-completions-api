export const createStreamEventRouter = ({
  parseStreamEventLine,
  extractMetadataFromPayload,
  sanitizeMetadata = false,
  appendProtoEvent,
  reqId,
  route = "/v1/chat/completions",
  mode = "chat_stream",
  handleParsedEvent,
  trackToolSignals,
  extractFinishReasonFromMessage,
  trackFinishReason,
  updateUsageCounts,
  mergeMetadataInfo,
  recordSanitizedMetadata,
  shouldDropFunctionCallOutput,
  getUsageTrigger,
  markUsageTriggerIfMissing,
  hasAnyChoiceSent,
  hasLengthEvidence,
  emitFinishChunk,
  finalizeStream,
} = {}) => {
  const handleLine = (line) => {
    const parsed = parseStreamEventLine?.(line, {
      extractMetadataFromPayload,
      sanitizeMetadata,
    });
    if (!parsed) return { handled: false };
    const { type: t, payload, params, messagePayload, metadataInfo } = parsed;
    if (typeof appendProtoEvent === "function") {
      appendProtoEvent({
        ts: Date.now(),
        req_id: reqId,
        route,
        mode,
        kind: "event",
        event: payload,
      });
    }
    if (messagePayload) {
      if (typeof trackToolSignals === "function") trackToolSignals(messagePayload);
      const finishCandidate =
        typeof extractFinishReasonFromMessage === "function"
          ? extractFinishReasonFromMessage(messagePayload)
          : null;
      if (finishCandidate && typeof trackFinishReason === "function") {
        trackFinishReason(finishCandidate, t || "event");
      }
    }
    if (
      t === "agent_message_content_delta" ||
      t === "agent_message_delta" ||
      t === "agent_message"
    ) {
      if (typeof handleParsedEvent === "function") handleParsedEvent(parsed);
      return { handled: true };
    }
    if (t === "function_call_output") {
      if (typeof shouldDropFunctionCallOutput === "function") {
        if (shouldDropFunctionCallOutput(messagePayload)) return { handled: true };
      }
    } else if (t === "metadata") {
      if (sanitizeMetadata && metadataInfo) {
        if (typeof mergeMetadataInfo === "function") mergeMetadataInfo(metadataInfo);
        if (typeof recordSanitizedMetadata === "function") {
          recordSanitizedMetadata({
            stage: "metadata_event",
            eventType: t,
            metadata: metadataInfo.metadata,
            removed: [],
            sources: metadataInfo.sources,
          });
        }
      }
    } else if (t === "token_count") {
      const promptTokens = Number(
        messagePayload?.prompt_tokens ??
          messagePayload?.promptTokens ??
          messagePayload?.token_count?.prompt_tokens ??
          params?.prompt_tokens ??
          params?.promptTokens ??
          params?.token_count?.prompt_tokens
      );
      const completionTokens = Number(
        messagePayload?.completion_tokens ??
          messagePayload?.completionTokens ??
          messagePayload?.token_count?.completion_tokens ??
          params?.completion_tokens ??
          params?.completionTokens ??
          params?.token_count?.completion_tokens
      );
      if (typeof updateUsageCounts === "function") {
        updateUsageCounts("token_count", { prompt: promptTokens, completion: completionTokens });
      }
      const tokenFinishReason =
        typeof extractFinishReasonFromMessage === "function"
          ? extractFinishReasonFromMessage(messagePayload)
          : null;
      if (tokenFinishReason && typeof trackFinishReason === "function") {
        trackFinishReason(tokenFinishReason, "token_count");
      }
    } else if (t === "usage") {
      const promptTokens = Number(
        messagePayload?.prompt_tokens ??
          messagePayload?.usage?.prompt_tokens ??
          params?.usage?.prompt_tokens ??
          params?.prompt_tokens ??
          params?.promptTokens ??
          params?.token_count?.prompt_tokens
      );
      const completionTokens = Number(
        messagePayload?.completion_tokens ??
          messagePayload?.usage?.completion_tokens ??
          params?.usage?.completion_tokens ??
          params?.completion_tokens ??
          params?.completionTokens ??
          params?.token_count?.completion_tokens
      );
      if (typeof updateUsageCounts === "function") {
        updateUsageCounts(
          "provider",
          { prompt: promptTokens, completion: completionTokens },
          { provider: true }
        );
      }
    } else if (t === "task_complete") {
      const finishReason =
        typeof extractFinishReasonFromMessage === "function"
          ? extractFinishReasonFromMessage(messagePayload)
          : null;
      if (finishReason && typeof trackFinishReason === "function") {
        trackFinishReason(finishReason, "task_complete");
      } else if (typeof hasAnyChoiceSent === "function" && !hasAnyChoiceSent()) {
        if (typeof trackFinishReason === "function") {
          trackFinishReason("length", "task_complete");
        }
      } else if (typeof hasLengthEvidence === "function" && hasLengthEvidence()) {
        if (typeof trackFinishReason === "function") {
          trackFinishReason("length", "task_complete");
        }
      }
      const promptTokens = Number(
        messagePayload?.prompt_tokens ??
          messagePayload?.token_count?.prompt_tokens ??
          params?.token_count?.prompt_tokens ??
          params?.prompt_tokens ??
          params?.promptTokens
      );
      const completionTokens = Number(
        messagePayload?.completion_tokens ??
          messagePayload?.token_count?.completion_tokens ??
          params?.token_count?.completion_tokens ??
          params?.completion_tokens ??
          params?.completionTokens
      );
      const usageTrigger = typeof getUsageTrigger === "function" ? getUsageTrigger() : null;
      if (Number.isFinite(promptTokens) || Number.isFinite(completionTokens)) {
        if (typeof updateUsageCounts === "function") {
          updateUsageCounts(usageTrigger || "task_complete", {
            prompt: promptTokens,
            completion: completionTokens,
          });
        }
      } else if (typeof markUsageTriggerIfMissing === "function") {
        markUsageTriggerIfMissing("task_complete");
      }
      if (typeof emitFinishChunk === "function") emitFinishChunk(finishReason || undefined);
      if (typeof finalizeStream === "function") {
        finalizeStream({ reason: finishReason, trigger: usageTrigger || "task_complete" });
      }
      return { handled: true, stop: true };
    }
    return { handled: true };
  };

  return { handleLine };
};
