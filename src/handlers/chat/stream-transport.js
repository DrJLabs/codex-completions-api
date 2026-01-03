import { parseStreamEventLine } from "./stream-event.js";

export const wireStreamTransport = ({
  child,
  runtime,
  resolveChoiceIndexFromPayload,
  extractMetadataFromPayload,
  sanitizeMetadata = false,
} = {}) => {
  const handleLine = (line) => {
    const parsed = parseStreamEventLine(line, {
      resolveChoiceIndexFromPayload,
      extractMetadataFromPayload,
      sanitizeMetadata,
    });
    if (!parsed) return false;
    const { type, params, messagePayload, metadataInfo, baseChoiceIndex } = parsed;
    if (type === "agent_message_content_delta" || type === "agent_message_delta") {
      if (!runtime?.handleDelta) return false;
      const deltaPayload = messagePayload?.delta ?? messagePayload;
      const choiceIndex =
        typeof resolveChoiceIndexFromPayload === "function"
          ? (resolveChoiceIndexFromPayload(deltaPayload, messagePayload, params) ??
            baseChoiceIndex ??
            0)
          : (baseChoiceIndex ?? 0);
      runtime.handleDelta({
        choiceIndex,
        delta: deltaPayload,
        metadataInfo,
        eventType: type,
      });
      return true;
    }
    if (type === "agent_message") {
      if (!runtime?.handleMessage) return false;
      const finalMessage = messagePayload?.message ?? messagePayload;
      const choiceIndex =
        typeof resolveChoiceIndexFromPayload === "function"
          ? (resolveChoiceIndexFromPayload(finalMessage, messagePayload, params) ??
            baseChoiceIndex ??
            0)
          : (baseChoiceIndex ?? 0);
      runtime.handleMessage({
        choiceIndex,
        message: finalMessage,
        metadataInfo,
        eventType: type,
      });
      return true;
    }
    return false;
  };

  if (child?.stdout?.on) {
    let buffer = "";
    child.stdout.on("data", (chunk) => {
      buffer += String(chunk);
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        handleLine(line);
      }
    });
  }

  return { handleLine };
};
