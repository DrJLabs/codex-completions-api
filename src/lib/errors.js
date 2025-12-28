const AUTH_DEFAULT_MESSAGE = "unauthorized";
const AUTH_DEFAULT_CODE = "invalid_api_key";

export function authErrorBody(detailsOrOptions = null) {
  let details = null;
  let codeOverride = null;
  let messageOverride = null;

  if (
    detailsOrOptions &&
    typeof detailsOrOptions === "object" &&
    !Array.isArray(detailsOrOptions)
  ) {
    const hasOverrides =
      Object.prototype.hasOwnProperty.call(detailsOrOptions, "details") ||
      Object.prototype.hasOwnProperty.call(detailsOrOptions, "code") ||
      Object.prototype.hasOwnProperty.call(detailsOrOptions, "message");
    if (hasOverrides) {
      details = detailsOrOptions.details ?? null;
      codeOverride = detailsOrOptions.code ?? null;
      messageOverride = detailsOrOptions.message ?? null;
    } else {
      details = detailsOrOptions;
    }
  }

  const error = {
    message:
      typeof messageOverride === "string" && messageOverride
        ? messageOverride
        : AUTH_DEFAULT_MESSAGE,
    type: "authentication_error",
    code: typeof codeOverride === "string" && codeOverride ? codeOverride : AUTH_DEFAULT_CODE,
  };
  if (details && typeof details === "object" && Object.keys(details).length > 0) {
    error.details = details;
  }
  return { error };
}

export function modelNotFoundBody(model) {
  return {
    error: {
      message: `The model ${model} does not exist or you do not have access to it.`,
      type: "invalid_request_error",
      param: "model",
      code: "model_not_found",
    },
  };
}

export function invalidRequestBody(param, message, code = "invalid_request_error") {
  return {
    error: {
      message: message || "invalid request",
      type: "invalid_request_error",
      param,
      code: code || "invalid_request_error",
    },
  };
}

export function tokensExceededBody(param = "messages") {
  return {
    error: {
      message: "context length exceeded",
      type: "tokens_exceeded_error",
      param,
      code: "context_length_exceeded",
    },
  };
}

export function permissionErrorBody(message = "permission denied") {
  return {
    error: { message, type: "permission_error", code: "permission_denied" },
  };
}

export function serverErrorBody(message = "internal server error") {
  return { error: { message, type: "server_error", code: "internal_error" } };
}

export function sseErrorBody(e) {
  const raw = (e && e.message) || "spawn error";
  const isTimeout = /timeout/i.test(String(raw));
  return {
    error: {
      message: isTimeout ? "request timeout" : raw,
      type: isTimeout ? "timeout_error" : "server_error",
      code: isTimeout ? "request_timeout" : "spawn_error",
    },
  };
}
