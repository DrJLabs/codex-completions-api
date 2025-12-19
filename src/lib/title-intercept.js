import { nanoid } from "nanoid";
import { config as CFG } from "../config/index.js";

const TITLE_INTERCEPT_ENABLED = CFG.PROXY_TITLE_GEN_INTERCEPT;

const DEFAULT_TITLE = "New Conversation";

const isTitleGenerationText = (text) => {
  if (!text) return false;
  const lower = text.toLowerCase();
  const hasConversationTag = lower.includes("<conversation_text>");
  const hasTitleWord = lower.includes("title");
  const hasConcise = lower.includes("concise title");
  const hasMaxWords = lower.includes("max 5 words") || lower.includes("maximum of five words");
  return (
    (hasTitleWord || hasConcise || hasMaxWords) &&
    (hasConversationTag || lower.includes("conversation:"))
  );
};

const flattenContent = (content) => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(flattenContent).join(" ");
  if (content && typeof content === "object") {
    if (typeof content.content === "string") return content.content;
    if (typeof content.text === "string") return content.text;
  }
  return "";
};

const collectUserText = (items = []) => {
  if (!Array.isArray(items)) return "";
  return items
    .filter((m) => (m?.role || "").toLowerCase() === "user")
    .map((m) => flattenContent(m?.content))
    .join(" ")
    .trim();
};

const collectInputText = (input = []) =>
  Array.isArray(input)
    ? input
        .map((entry) => {
          if (typeof entry === "string") return entry;
          if (entry && typeof entry === "object") {
            if (typeof entry.content === "string") return entry.content;
            if (typeof entry.text === "string") return entry.text;
            if (typeof entry.message === "string") return entry.message;
            if (Array.isArray(entry.content)) return flattenContent(entry.content);
          }
          return "";
        })
        .join(" ")
        .trim()
    : "";

const extractConversationText = (rawText) => {
  if (!rawText) return "";
  const match = rawText.match(/<conversation_text>([\s\S]*?)<\/conversation_text>/i);
  if (match?.[1]) return match[1].trim();
  return rawText.trim();
};

const generateTitle = (conversationText) => {
  const cleaned = conversationText.replace(/\s+/g, " ").trim();
  if (!cleaned) return DEFAULT_TITLE;
  const words = cleaned.split(" ").slice(0, 5).join(" ");
  return words || DEFAULT_TITLE;
};

const createTitleResponse = ({ title, model, stream }) => {
  const id = `chatcmpl-${nanoid()}`;
  const created = Math.floor(Date.now() / 1000);

  if (stream) {
    return {
      isStream: true,
      chunks: [
        `data: ${JSON.stringify({
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
          usage: null,
        })}\n\n`,
        `data: ${JSON.stringify({
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta: { content: title }, finish_reason: null }],
          usage: null,
        })}\n\n`,
        `data: ${JSON.stringify({
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: null,
        })}\n\n`,
        "data: [DONE]\n\n",
      ],
    };
  }

  return {
    isStream: false,
    body: {
      id,
      object: "chat.completion",
      created,
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: title },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    },
  };
};

export function maybeHandleTitleIntercept({ body = {}, model, res, stream }) {
  if (!TITLE_INTERCEPT_ENABLED) return false;

  const candidateText =
    collectUserText(body.messages || []) ||
    collectUserText(body.input || []) ||
    collectInputText(body.input || []);

  if (!isTitleGenerationText(candidateText)) return false;

  const conversationText = extractConversationText(candidateText);
  const title = generateTitle(conversationText);
  const response = createTitleResponse({ title, model, stream });

  if (response.isStream) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    for (const chunk of response.chunks) {
      res.write(chunk);
    }
    res.end();
    return true;
  }

  res.json(response.body);
  return true;
}
