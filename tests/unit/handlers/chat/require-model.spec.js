import { describe, expect, it, vi } from "vitest";
import { requireModel } from "../../../../src/handlers/chat/require-model.js";
import { invalidRequestBody } from "../../../../src/lib/errors.js";

describe("requireModel", () => {
  it("returns trimmed model when present", () => {
    const model = requireModel({
      body: { model: "  gpt-test  " },
    });

    expect(model).toBe("gpt-test");
  });

  it("logs usage failure, applies CORS, and uses sendJson when model missing", () => {
    const req = { headers: {} };
    const res = {};
    const logUsageFailure = vi.fn();
    const applyCors = vi.fn();
    const sendJson = vi.fn();

    const model = requireModel({
      req,
      res,
      body: {},
      reqId: "req-1",
      started: 123,
      route: "/v1/chat/completions",
      mode: "chat",
      stream: true,
      logUsageFailure,
      applyCors,
      sendJson,
    });

    expect(model).toBe("");
    expect(logUsageFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        req,
        res,
        reqId: "req-1",
        started: 123,
        route: "/v1/chat/completions",
        mode: "chat",
        statusCode: 400,
        reason: "invalid_request",
        errorCode: "model_required",
        stream: true,
      })
    );
    expect(applyCors).toHaveBeenCalledWith(req, res);
    expect(sendJson).toHaveBeenCalledWith(
      400,
      invalidRequestBody("model", "model is required", "model_required")
    );
  });

  it("falls back to res.status().json when sendJson missing", () => {
    const req = { headers: {} };
    const res = {
      statusCode: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json: vi.fn(),
    };
    const applyCors = vi.fn();

    const model = requireModel({
      req,
      res,
      body: {},
      applyCors,
    });

    expect(model).toBe("");
    expect(applyCors).toHaveBeenCalledWith(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.json).toHaveBeenCalledWith(
      invalidRequestBody("model", "model is required", "model_required")
    );
  });
});
