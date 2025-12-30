import { nanoid } from "nanoid";
import { config as CFG } from "../config/index.js";
import { runCodexExec } from "../services/codex-exec.js";
import { serverErrorBody } from "./errors.js";

const TITLE_INTERCEPT_ENABLED = CFG.PROXY_TITLE_GEN_INTERCEPT;
const DEFAULT_MODEL = CFG.PROXY_TITLE_SUMMARY_EXEC_MODEL || "gpt-5.2";

const flattenContent = (content) => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(flattenContent).join("\n");
  if (content && typeof content === "object") {
    if (typeof content.content === "string") return content.content;
    if (typeof content.text === "string") return content.text;
    if (Array.isArray(content.content)) return flattenContent(content.content);
  }
  return "";
};

const collectMessages = (body = {}) => {
  if (Array.isArray(body.messages) && body.messages.length) {
    return body.messages;
  }
  if (Array.isArray(body.input)) {
    return body.input.filter((item) => item && item.type === "message");
  }
  return [];
};

const collectPromptText = (body = {}) => {
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

const isTitleSummaryPrompt = (text) => {
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

const isTitleOnlyPrompt = (text) => {
  if (!text) return false;
  const lower = text.toLowerCase();
  const hasTitleWord = lower.includes("title");
  const hasConcise = lower.includes("concise title");
  const hasMaxWords = lower.includes("max 5 words") || lower.includes("maximum of five words");
  const hasConversationTag =
    lower.includes("<conversation_text>") || lower.includes("conversation:");
  return hasTitleWord && (hasConcise || hasMaxWords) && hasConversationTag;
};

const createChatResponse = ({ content, model, stream }) => {
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
          choices: [{ index: 0, delta: { content }, finish_reason: null }],
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
          message: { role: "assistant", content },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    },
  };
};

export async function maybeHandleTitleIntercept({ body = {}, model: _model, res, stream }) {
  if (!TITLE_INTERCEPT_ENABLED) return false;
  const promptText = collectPromptText(body);
  if (!isTitleSummaryPrompt(promptText) && !isTitleOnlyPrompt(promptText)) return false;

  const execModel = DEFAULT_MODEL;
  try {
    const output = await runCodexExec({
      prompt: promptText,
      model: execModel,
    });
    const response = createChatResponse({ content: output, model: execModel, stream });
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
  } catch {
    res.status(502).json(serverErrorBody("title/summary exec failed"));
    return true;
  }
}
