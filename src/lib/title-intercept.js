import { nanoid } from "nanoid";
import { config as CFG } from "../config/index.js";
import { runCodexExec } from "../services/codex-exec.js";
import { logStructured, sha256 } from "../services/logging/schema.js";
import { serverErrorBody } from "./errors.js";
import { applyProxyTraceHeaders } from "./request-context.js";
import {
  collectPromptText,
  isTitleOnlyPrompt,
  isTitleSummaryPrompt,
} from "./title-prompt-utils.js";

const TITLE_INTERCEPT_ENABLED = CFG.PROXY_TITLE_GEN_INTERCEPT;
const DEFAULT_MODEL = CFG.PROXY_TITLE_SUMMARY_EXEC_MODEL;

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

export async function maybeHandleTitleIntercept({ req, res, body = {}, stream } = {}) {
  if (!TITLE_INTERCEPT_ENABLED) return false;
  const promptText = collectPromptText(body);
  const isSummary = isTitleSummaryPrompt(promptText);
  const isTitle = !isSummary && isTitleOnlyPrompt(promptText);
  if (!isSummary && !isTitle) return false;

  applyProxyTraceHeaders(res);
  res.locals = res.locals || {};
  const locals = res.locals;
  const route = req?.path || req?.originalUrl || "/v1/chat/completions";
  locals.endpoint_mode = "chat";
  locals.routeOverride = route;
  locals.modeOverride =
    route === "/v1/completions" ? "completions_title_intercept" : "chat_title_intercept";

  const execModel = DEFAULT_MODEL;
  try {
    const output = await runCodexExec({
      prompt: promptText,
      model: execModel,
      reqId: locals.req_id,
      route,
      mode: locals.modeOverride,
    });
    const response = createChatResponse({ content: output, model: execModel, stream });
    logStructured(
      {
        component: "chat",
        event: "chat_title_summary_intercept",
        level: "info",
        req_id: locals.req_id,
        trace_id: locals.trace_id,
        route,
        mode: locals.modeOverride,
        model: execModel,
      },
      {
        kind: isSummary ? "title_summary" : "title",
        copilot_trace_id: locals.copilot_trace_id || null,
        output_text_bytes: Buffer.byteLength(output, "utf8"),
        output_text_hash: sha256(output),
        stream: Boolean(stream),
      }
    );
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
  } catch (err) {
    logStructured(
      {
        component: "chat",
        event: "chat_title_summary_intercept_error",
        level: "error",
        req_id: locals?.req_id || null,
        trace_id: locals?.trace_id || null,
        route: locals?.routeOverride || null,
        mode: locals?.modeOverride || null,
        model: execModel,
      },
      {
        kind: isSummary ? "title_summary" : "title",
        message: err?.message || String(err || "exec failed"),
      }
    );
    res.status(502).json(serverErrorBody("title/summary exec failed"));
    return true;
  }
}
