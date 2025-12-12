import { postChatStream } from "../chat/stream.js";
import { applyDefaultProxyOutputModeHeader, coerceInputToChatMessages } from "./shared.js";
import { createResponsesStreamAdapter } from "./stream-adapter.js";
import { config as CFG } from "../../config/index.js";

export async function postResponsesStream(req, res) {
  const originalBody = req.body || {};
  const chatBody = { ...originalBody };
  chatBody.stream = true;
  chatBody.messages = coerceInputToChatMessages(originalBody);
  delete chatBody.instructions;
  delete chatBody.input;
  delete chatBody.previous_response_id;

  res.locals = res.locals || {};
  res.locals.routeOverride = "/v1/responses";
  res.locals.modeOverride = "responses_stream";
  res.locals.streamAdapter = createResponsesStreamAdapter(res, originalBody);

  const restoreOutputMode = applyDefaultProxyOutputModeHeader(req, CFG.PROXY_RESPONSES_OUTPUT_MODE);

  try {
    req.body = chatBody;
    await postChatStream(req, res);
  } finally {
    req.body = originalBody;
    if (res.locals) delete res.locals.streamAdapter;
    restoreOutputMode();
  }
}
