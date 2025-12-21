import { postChatStream } from "../chat/stream.js";
import {
  applyDefaultProxyOutputModeHeader,
  coerceInputToChatMessages,
  resolveResponsesOutputMode,
} from "./shared.js";
import { createResponsesStreamAdapter } from "./stream-adapter.js";
import { config as CFG } from "../../config/index.js";
import { logResponsesIngressRaw } from "./ingress-logging.js";
import { applyProxyTraceHeaders } from "../../lib/request-context.js";

export async function postResponsesStream(req, res) {
  applyProxyTraceHeaders(res);
  const originalBody = req.body || {};
  const chatBody = { ...originalBody };
  chatBody.stream = true;
  chatBody.messages = coerceInputToChatMessages(originalBody);
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
  locals.modeOverride = "responses_stream";

  const outputModeRequested = req.headers["x-proxy-output-mode"]
    ? String(req.headers["x-proxy-output-mode"])
    : null;
  const { effective: outputModeEffective } = resolveResponsesOutputMode({
    req,
    defaultValue: CFG.PROXY_RESPONSES_OUTPUT_MODE,
    copilotDefault: "obsidian-xml",
  });
  const restoreOutputMode = applyDefaultProxyOutputModeHeader(req, outputModeEffective);
  locals.output_mode_requested = outputModeRequested;
  locals.output_mode_effective = outputModeEffective;
  locals.streamAdapter = createResponsesStreamAdapter(res, originalBody, req);

  logResponsesIngressRaw({
    req,
    res,
    body: originalBody,
    outputModeRequested,
    outputModeEffective,
  });

  try {
    req.body = chatBody;
    await postChatStream(req, res);
  } finally {
    req.body = originalBody;
    if (res.locals) delete res.locals.streamAdapter;
    restoreOutputMode();
  }
}
