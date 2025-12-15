import { postChatNonStream } from "../chat/nonstream.js";
import {
  applyDefaultProxyOutputModeHeader,
  coerceInputToChatMessages,
  convertChatResponseToResponses,
} from "./shared.js";
import { config as CFG } from "../../config/index.js";
import { logResponsesIngressRaw } from "./ingress-logging.js";
import { logStructured, sha256 } from "../../services/logging/schema.js";

export async function postResponsesNonStream(req, res) {
  const originalBody = req.body || {};
  const chatBody = { ...originalBody };
  chatBody.messages = coerceInputToChatMessages(originalBody);
  chatBody.stream = false;
  const fallbackMax = CFG.PROXY_RESPONSES_DEFAULT_MAX_TOKENS || 0;
  if (
    fallbackMax > 0 &&
    chatBody.max_tokens === undefined &&
    chatBody.max_completion_tokens === undefined &&
    chatBody.maxOutputTokens === undefined
  ) {
    chatBody.max_tokens = fallbackMax;
  }
  delete chatBody.instructions;
  delete chatBody.input;
  delete chatBody.previous_response_id;

  res.locals = res.locals || {};
  const locals = res.locals;
  locals.endpoint_mode = "responses";
  locals.routeOverride = "/v1/responses";
  locals.modeOverride = "responses_nonstream";
  const transform = (payload, statusCode) => {
    if (statusCode >= 400 || payload === undefined || payload === null) {
      return payload;
    }
    const transformed = convertChatResponseToResponses(payload, originalBody);
    try {
      const prev = originalBody?.previous_response_id;
      const usage = transformed?.usage || null;
      logStructured(
        {
          component: "responses",
          event: "responses_nonstream_summary",
          level: "debug",
          req_id: locals.req_id,
          trace_id: locals.trace_id,
          route: locals.routeOverride || "/v1/responses",
          mode: locals.modeOverride || locals.mode,
          model: transformed?.model ?? null,
        },
        {
          endpoint_mode: locals.endpoint_mode || "responses",
          copilot_trace_id: locals.copilot_trace_id || null,
          status_emitted: transformed?.status ?? null,
          usage_input_tokens: usage?.input_tokens ?? null,
          usage_output_tokens: usage?.output_tokens ?? null,
          usage_total_tokens: usage?.total_tokens ?? null,
          previous_response_id_hash: prev ? sha256(prev) : null,
          output_mode_effective: locals.output_mode_effective ?? null,
          response_shape_version: "responses_v0_nonstream_openai_json",
        }
      );
    } catch {}
    return transformed;
  };

  const outputModeRequested = req.headers["x-proxy-output-mode"]
    ? String(req.headers["x-proxy-output-mode"])
    : null;
  const restoreOutputMode = applyDefaultProxyOutputModeHeader(req, CFG.PROXY_RESPONSES_OUTPUT_MODE);
  const outputModeEffective = req.headers["x-proxy-output-mode"]
    ? String(req.headers["x-proxy-output-mode"])
    : null;
  locals.output_mode_requested = outputModeRequested;
  locals.output_mode_effective = outputModeEffective;

  logResponsesIngressRaw({
    req,
    res,
    body: originalBody,
    outputModeRequested,
    outputModeEffective,
  });

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (locals.responseTransform === transform) {
      delete locals.responseTransform;
    }
    if (locals.routeOverride === "/v1/responses") delete locals.routeOverride;
    if (locals.modeOverride === "responses_nonstream") delete locals.modeOverride;
    if (typeof res.off === "function") {
      res.off("finish", cleanup);
      res.off("close", cleanup);
    } else {
      res.removeListener?.("finish", cleanup);
      res.removeListener?.("close", cleanup);
    }
  };

  locals.responseTransform = transform;
  res.once("finish", cleanup);
  res.once("close", cleanup);

  try {
    req.body = chatBody;
    await postChatNonStream(req, res);
  } catch (error) {
    cleanup();
    throw error;
  } finally {
    req.body = originalBody;
    restoreOutputMode();
  }
}
