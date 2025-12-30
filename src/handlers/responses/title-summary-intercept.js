import { config as CFG } from "../../config/index.js";
import { runCodexExec } from "../../services/codex-exec.js";
import { applyProxyTraceHeaders } from "../../lib/request-context.js";
import { serverErrorBody } from "../../lib/errors.js";
import { detectCopilotRequest as detectCopilotRequestV2 } from "../../lib/copilot-detect.js";
import { logStructured, sha256 } from "../../services/logging/schema.js";
import { captureResponsesNonStream } from "./capture.js";
import { logResponsesIngressRaw, summarizeResponsesIngress } from "./ingress-logging.js";
import { normalizeMessageId, normalizeResponseId, resolveResponsesOutputMode } from "./shared.js";

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

const buildResponsesEnvelope = ({ text, model, requestBody }) => {
  const responseId = normalizeResponseId();
  const messageId = normalizeMessageId();
  const output = [
    {
      id: messageId,
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text }],
    },
  ];
  const payload = {
    id: responseId,
    status: "completed",
    model,
    output,
  };
  if (requestBody?.previous_response_id) {
    payload.previous_response_id = requestBody.previous_response_id;
  }
  return payload;
};

export async function maybeHandleTitleSummaryIntercept({
  req,
  res,
  body = {},
  model: _model,
  stream,
} = {}) {
  if (!TITLE_INTERCEPT_ENABLED) return false;
  if (!req || !res) return false;

  const promptText = collectPromptText(body);
  const isSummary = isTitleSummaryPrompt(promptText);
  const isTitle = !isSummary && isTitleOnlyPrompt(promptText);
  if (!isSummary && !isTitle) return false;

  applyProxyTraceHeaders(res);
  res.locals = res.locals || {};
  const locals = res.locals;
  locals.endpoint_mode = "responses";
  locals.routeOverride = "/v1/responses";
  locals.modeOverride = "responses_intercept";

  const ingressSummary = summarizeResponsesIngress(body, req);
  const copilotDetection = detectCopilotRequestV2({
    headers: req?.headers,
    markers: ingressSummary,
    responsesSummary: ingressSummary,
  });
  locals.copilot_detected = copilotDetection.copilot_detected;
  locals.copilot_detect_tier = copilotDetection.copilot_detect_tier;
  locals.copilot_detect_reasons = copilotDetection.copilot_detect_reasons;

  const outputModeRequested = req.headers["x-proxy-output-mode"]
    ? String(req.headers["x-proxy-output-mode"])
    : null;
  const { effective: outputModeEffective } = resolveResponsesOutputMode({
    req,
    defaultValue: CFG.PROXY_RESPONSES_OUTPUT_MODE,
    copilotDefault: "obsidian-xml",
    copilotDetection: CFG.PROXY_COPILOT_AUTO_DETECT ? copilotDetection : null,
  });
  locals.output_mode_requested = outputModeRequested;
  locals.output_mode_effective = outputModeEffective;

  logResponsesIngressRaw({
    req,
    res,
    body,
    outputModeRequested,
    outputModeEffective,
    ingressSummary,
    copilotDetection,
  });

  const execModel = DEFAULT_MODEL;
  try {
    const outputText = await runCodexExec({
      prompt: promptText,
      model: execModel,
      reqId: locals.req_id,
      route: locals.routeOverride,
      mode: locals.modeOverride,
    });

    const responseBody = buildResponsesEnvelope({
      text: outputText,
      model: execModel,
      requestBody: body,
    });

    captureResponsesNonStream({
      req,
      res,
      requestBody: body,
      responseBody,
      outputModeEffective,
    });

    logStructured(
      {
        component: "responses",
        event: "responses_title_summary_intercept",
        level: "info",
        req_id: locals.req_id,
        trace_id: locals.trace_id,
        route: locals.routeOverride,
        mode: locals.modeOverride,
        model: execModel,
      },
      {
        kind: isSummary ? "title_summary" : "title",
        copilot_trace_id: locals.copilot_trace_id || null,
        output_text_bytes: Buffer.byteLength(outputText, "utf8"),
        output_text_hash: sha256(outputText),
        output_mode_effective: outputModeEffective,
        stream: Boolean(stream),
      }
    );

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(200).json(responseBody);
    return true;
  } catch (err) {
    logStructured(
      {
        component: "responses",
        event: "responses_title_summary_intercept_error",
        level: "error",
        req_id: locals.req_id,
        trace_id: locals.trace_id,
        route: locals.routeOverride,
        mode: locals.modeOverride,
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
