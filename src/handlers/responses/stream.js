import { postChatStream } from "../chat/stream.js";
import { coerceInputToChatMessages } from "./shared.js";
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

  const desiredOutputMode = String(CFG.PROXY_RESPONSES_OUTPUT_MODE || "").trim();
  const originalOutputHeader = req.headers?.["x-proxy-output-mode"];
  const shouldOverrideOutputMode =
    (!originalOutputHeader || !String(originalOutputHeader).trim()) && desiredOutputMode;

  try {
    req.body = chatBody;
    if (shouldOverrideOutputMode) {
      req.headers["x-proxy-output-mode"] = desiredOutputMode;
    }
    await postChatStream(req, res);
  } finally {
    req.body = originalBody;
    if (res.locals) delete res.locals.streamAdapter;
    if (shouldOverrideOutputMode) {
      if (originalOutputHeader === undefined) {
        delete req.headers["x-proxy-output-mode"];
      } else {
        req.headers["x-proxy-output-mode"] = originalOutputHeader;
      }
    }
  }
}
