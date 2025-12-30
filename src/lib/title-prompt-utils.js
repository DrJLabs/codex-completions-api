export const flattenContent = (content) => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(flattenContent).join("\n");
  if (content && typeof content === "object") {
    if (typeof content.content === "string") return content.content;
    if (typeof content.text === "string") return content.text;
    if (Array.isArray(content.content)) return flattenContent(content.content);
  }
  return "";
};

export const collectMessages = (body = {}) => {
  if (Array.isArray(body.messages) && body.messages.length) {
    return body.messages;
  }
  if (Array.isArray(body.input)) {
    return body.input.filter((item) => item && item.type === "message");
  }
  return [];
};

export const collectPromptText = (body = {}) => {
  const messages = collectMessages(body);
  if (!messages.length) {
    if (typeof body.input === "string") return body.input.trim();
    return "";
  }
  return messages
    .map((message) => {
      const role = typeof message?.role === "string" ? message.role.trim() : "";
      const text = flattenContent(message?.content);
      return role ? `${role}: ${text}` : text;
    })
    .join("\n\n")
    .trim();
};

export const isTitleSummaryPrompt = (text) => {
  if (!text) return false;
  const lower = text.toLowerCase();
  const hasSummary = lower.includes("summary");
  const hasTitle = lower.includes("title");
  const hasBothPhrase =
    lower.includes("both a title and a summary") || lower.includes("title and a summary");
  const hasOutputFormat = lower.includes("# output format") || lower.includes("output format");
  const hasJsonKeys = /"title"\s*:\s*"/i.test(text) && /"summary"\s*:\s*"/i.test(text);
  return (
    (hasTitle && hasSummary && hasOutputFormat && hasJsonKeys) || (hasBothPhrase && hasJsonKeys)
  );
};

export const isTitleOnlyPrompt = (text) => {
  if (!text) return false;
  const lower = text.toLowerCase();
  const hasTitleWord = lower.includes("title");
  const hasConcise = lower.includes("concise title");
  const hasMaxWords = lower.includes("max 5 words") || lower.includes("maximum of five words");
  const hasConversationTag =
    lower.includes("<conversation_text>") || lower.includes("conversation:");
  return hasTitleWord && (hasConcise || hasMaxWords) && hasConversationTag;
};
