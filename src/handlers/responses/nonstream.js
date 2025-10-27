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
  const locals = res.locals;
  const transform = (payload, statusCode) => {
    if (statusCode >= 400 || payload === undefined || payload === null) {
      return payload;
    }
    return convertChatResponseToResponses(payload, originalBody);
  };

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (locals.responseTransform === transform) {
      delete locals.responseTransform;
    }
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
  }
}
