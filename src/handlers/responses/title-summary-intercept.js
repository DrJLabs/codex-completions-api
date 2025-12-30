import { config as CFG } from "../../config/index.js";
import { runCodexExec } from "../../services/codex-exec.js";
import { applyProxyTraceHeaders } from "../../lib/request-context.js";
import { serverErrorBody } from "../../lib/errors.js";
import { detectCopilotRequest as detectCopilotRequestV2 } from "../../lib/copilot-detect.js";
import {
  collectPromptText,
  isTitleOnlyPrompt,
  isTitleSummaryPrompt,
} from "../../lib/title-prompt-utils.js";
import { logStructured, sha256 } from "../../services/logging/schema.js";
import { captureResponsesNonStream } from "./capture.js";
import { logResponsesIngressRaw, summarizeResponsesIngress } from "./ingress-logging.js";
import { normalizeMessageId, normalizeResponseId, resolveResponsesOutputMode } from "./shared.js";

const TITLE_INTERCEPT_ENABLED = CFG.PROXY_TITLE_GEN_INTERCEPT;
const DEFAULT_MODEL = CFG.PROXY_TITLE_SUMMARY_EXEC_MODEL || "gpt-5.2";

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

export async function maybeHandleTitleSummaryIntercept({ req, res, body = {}, stream } = {}) {
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
