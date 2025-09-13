export function authErrorBody() {
  return {
    error: { message: "unauthorized", type: "authentication_error", code: "invalid_api_key" },
  };
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

export function invalidRequestBody(param, message) {
  return {
    error: {
      message: message || "invalid request",
      type: "invalid_request_error",
      param,
      code: "invalid_request_error",
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
