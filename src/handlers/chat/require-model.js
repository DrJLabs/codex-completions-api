import { invalidRequestBody } from "../../lib/errors.js";

export function requireModel({
  req,
  res,
  body,
  reqId,
  started,
  route,
  mode,
  stream,
  logUsageFailure,
  applyCors,
  sendJson,
}) {
  const model = typeof body?.model === "string" ? body.model.trim() : "";
  if (model) return model;

  if (typeof logUsageFailure === "function") {
    const payload = {
      req,
      res,
      reqId,
      started,
      route,
      mode,
      statusCode: 400,
      reason: "invalid_request",
      errorCode: "model_required",
    };
    if (stream !== undefined) payload.stream = stream;
    logUsageFailure(payload);
  }

  if (typeof applyCors === "function") {
    applyCors(req, res);
  }

  const payload = invalidRequestBody("model", "model is required", "model_required");
  if (typeof sendJson === "function") {
    sendJson(400, payload);
  } else if (res && typeof res.status === "function") {
    res.status(400).json(payload);
  }

  return "";
}
