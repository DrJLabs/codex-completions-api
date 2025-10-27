import { postChatNonStream } from "../chat/nonstream.js";
import { coerceInputToChatMessages, convertChatResponseToResponses } from "./shared.js";

export async function postResponsesNonStream(req, res) {
  const originalBody = req.body || {};
  const chatBody = { ...originalBody };
  chatBody.messages = coerceInputToChatMessages(originalBody);
  chatBody.stream = false;
  delete chatBody.instructions;
  delete chatBody.input;
  delete chatBody.previous_response_id;

  res.locals = res.locals || {};
  const transform = (payload, statusCode) => {
    if (statusCode >= 400 || payload === undefined || payload === null) {
      return payload;
    }
    return convertChatResponseToResponses(payload, originalBody);
  };
  res.locals.responseTransform = transform;

  try {
    req.body = chatBody;
    await postChatNonStream(req, res);
  } finally {
    req.body = originalBody;
  }
}
