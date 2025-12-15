import { postChatStream } from "../chat/stream.js";
import { applyDefaultProxyOutputModeHeader, coerceInputToChatMessages } from "./shared.js";
import { createResponsesStreamAdapter } from "./stream-adapter.js";
import { config as CFG } from "../../config/index.js";
import { logResponsesIngressRaw } from "./ingress-logging.js";

export async function postResponsesStream(req, res) {
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
  locals.streamAdapter = createResponsesStreamAdapter(res, originalBody);

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

  try {
    req.body = chatBody;
    await postChatStream(req, res);
  } finally {
    req.body = originalBody;
    if (res.locals) delete res.locals.streamAdapter;
    restoreOutputMode();
  }
}
