import { parseStreamEventLine } from "./stream-event.js";

export const wireStreamTransport = ({
  child,
  runtime,
  resolveChoiceIndexFromPayload,
  extractMetadataFromPayload,
  sanitizeMetadata = false,
} = {}) => {
  const resolveChoiceIndex = (payload, messagePayload, params, baseChoiceIndex) =>
    typeof resolveChoiceIndexFromPayload === "function"
      ? (resolveChoiceIndexFromPayload(payload, messagePayload, params) ?? baseChoiceIndex ?? 0)
      : (baseChoiceIndex ?? 0);

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
      const choiceIndex = resolveChoiceIndex(deltaPayload, messagePayload, params, baseChoiceIndex);
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
      const choiceIndex = resolveChoiceIndex(finalMessage, messagePayload, params, baseChoiceIndex);
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
    const flushBuffer = () => {
      if (buffer.length > 0) {
        handleLine(buffer);
        buffer = "";
      }
    };
    child.stdout.on("data", (chunk) => {
      buffer += String(chunk);
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        handleLine(line);
      }
    });
    child.stdout.on("end", flushBuffer);
    child.stdout.on("close", flushBuffer);
  }

  return { handleLine };
};
