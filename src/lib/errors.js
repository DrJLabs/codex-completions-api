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
