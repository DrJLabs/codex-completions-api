import { describe, expect, it } from "vitest";
import {
  authErrorBody,
  invalidRequestBody,
  modelNotFoundBody,
  permissionErrorBody,
  serverErrorBody,
  sseErrorBody,
  tokensExceededBody,
} from "../../../src/lib/errors.js";

describe("error helpers", () => {
  it("builds auth error bodies with defaults and overrides", () => {
    expect(authErrorBody()).toEqual({
      error: { message: "unauthorized", type: "authentication_error", code: "invalid_api_key" },
    });

    const details = { auth_url: "https://example.com/login" };
    expect(authErrorBody(details)).toEqual({
      error: {
        message: "unauthorized",
        type: "authentication_error",
        code: "invalid_api_key",
        details,
      },
    });

    expect(
      authErrorBody({
        message: "custom message",
        code: "custom_code",
        details: { login_id: "abc" },
      })
    ).toEqual({
      error: {
        message: "custom message",
        type: "authentication_error",
        code: "custom_code",
        details: { login_id: "abc" },
      },
    });
  });

  it("builds model and request errors", () => {
    expect(modelNotFoundBody("gpt-5")).toEqual({
      error: {
        message: "The model gpt-5 does not exist or you do not have access to it.",
        type: "invalid_request_error",
        param: "model",
        code: "model_not_found",
      },
    });

    expect(invalidRequestBody("n", "invalid n", "bad_param")).toEqual({
      error: {
        message: "invalid n",
        type: "invalid_request_error",
        param: "n",
        code: "bad_param",
      },
    });
    expect(invalidRequestBody("messages")).toEqual({
      error: {
        message: "invalid request",
        type: "invalid_request_error",
        param: "messages",
        code: "invalid_request_error",
      },
    });
  });

  it("builds tokens exceeded and permission errors", () => {
    expect(tokensExceededBody()).toEqual({
      error: {
        message: "context length exceeded",
        type: "tokens_exceeded_error",
        param: "messages",
        code: "context_length_exceeded",
      },
    });
    expect(tokensExceededBody("input")).toEqual({
      error: {
        message: "context length exceeded",
        type: "tokens_exceeded_error",
        param: "input",
        code: "context_length_exceeded",
      },
    });

    expect(permissionErrorBody()).toEqual({
      error: { message: "permission denied", type: "permission_error", code: "permission_denied" },
    });
    expect(permissionErrorBody("no")).toEqual({
      error: { message: "no", type: "permission_error", code: "permission_denied" },
    });
  });

  it("builds server and sse errors with timeout detection", () => {
    expect(serverErrorBody()).toEqual({
      error: { message: "internal server error", type: "server_error", code: "internal_error" },
    });
    expect(serverErrorBody("boom")).toEqual({
      error: { message: "boom", type: "server_error", code: "internal_error" },
    });

    expect(sseErrorBody(new Error("request timeout"))).toEqual({
      error: {
        message: "request timeout",
        type: "timeout_error",
        code: "request_timeout",
      },
    });
    expect(sseErrorBody(new Error("spawn error"))).toEqual({
      error: { message: "spawn error", type: "server_error", code: "spawn_error" },
    });
  });
});
