import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const postChatNonStreamMock = vi.fn();
const logResponsesIngressRawMock = vi.fn();
const summarizeResponsesIngressMock = vi.fn(() => ({}));
const captureResponsesNonStreamMock = vi.fn();
const logStructuredMock = vi.fn();
const summarizeTextPartsMock = vi.fn(() => ({
  output_text_bytes: 0,
  output_text_hash: "",
  xml_in_text: false,
}));
const summarizeToolUseItemsMock = vi.fn(() => ({
  tool_use_count: 0,
  tool_use_names: [],
  tool_use_names_truncated: false,
}));
const convertChatResponseToResponsesMock = vi.fn((payload) => ({
  id: payload.id || "resp_test",
  model: payload.model || "gpt-test",
  status: "completed",
  output: [],
}));
const resolveResponsesOutputModeMock = vi.fn(() => ({
  effective: "obsidian-xml",
  source: "default",
}));

const ORIGINAL_RESPONSES_DEFAULT_MAX_TOKENS = process.env.PROXY_RESPONSES_DEFAULT_MAX_TOKENS;
const ORIGINAL_MAX_CHAT_CHOICES = process.env.PROXY_MAX_CHAT_CHOICES;

vi.mock("../../../../src/handlers/chat/nonstream.js", () => ({
  postChatNonStream: (...args) => postChatNonStreamMock(...args),
}));

vi.mock("../../../../src/handlers/responses/ingress-logging.js", () => ({
  logResponsesIngressRaw: (...args) => logResponsesIngressRawMock(...args),
  summarizeResponsesIngress: (...args) => summarizeResponsesIngressMock(...args),
}));

vi.mock("../../../../src/handlers/responses/shared.js", async () => {
  const actual = await vi.importActual("../../../../src/handlers/responses/shared.js");
  return {
    ...actual,
    convertChatResponseToResponses: (...args) => convertChatResponseToResponsesMock(...args),
    resolveResponsesOutputMode: (...args) => resolveResponsesOutputModeMock(...args),
  };
});

vi.mock("../../../../src/handlers/responses/capture.js", () => ({
  captureResponsesNonStream: (...args) => captureResponsesNonStreamMock(...args),
}));

vi.mock("../../../../src/services/logging/schema.js", () => ({
  logStructured: (...args) => logStructuredMock(...args),
  sha256: (value) => `hash-${value}`,
}));

vi.mock("../../../../src/lib/observability/transform-summary.js", () => ({
  summarizeTextParts: (...args) => summarizeTextPartsMock(...args),
  summarizeToolUseItems: (...args) => summarizeToolUseItemsMock(...args),
}));

vi.mock("../../../../src/lib/copilot-detect.js", () => ({
  detectCopilotRequest: () => ({
    copilot_detected: false,
    copilot_detect_tier: null,
    copilot_detect_reasons: [],
  }),
}));

const makeReq = (body) => ({
  body,
  headers: {},
  method: "POST",
});

const makeRes = () => {
  const res = new EventEmitter();
  res.locals = {};
  res.headersSent = false;
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.once = vi.fn((event, handler) => res.on(event, handler));
  res.off = vi.fn((event, handler) => res.removeListener(event, handler));
  return res;
};

afterEach(() => {
  if (ORIGINAL_RESPONSES_DEFAULT_MAX_TOKENS === undefined) {
    delete process.env.PROXY_RESPONSES_DEFAULT_MAX_TOKENS;
  } else {
    process.env.PROXY_RESPONSES_DEFAULT_MAX_TOKENS = ORIGINAL_RESPONSES_DEFAULT_MAX_TOKENS;
  }
  if (ORIGINAL_MAX_CHAT_CHOICES === undefined) {
    delete process.env.PROXY_MAX_CHAT_CHOICES;
  } else {
    process.env.PROXY_MAX_CHAT_CHOICES = ORIGINAL_MAX_CHAT_CHOICES;
  }
  postChatNonStreamMock.mockReset();
  logResponsesIngressRawMock.mockReset();
  summarizeResponsesIngressMock.mockReset();
  captureResponsesNonStreamMock.mockReset();
  logStructuredMock.mockReset();
  summarizeTextPartsMock.mockReset();
  summarizeToolUseItemsMock.mockReset();
  convertChatResponseToResponsesMock.mockReset();
  resolveResponsesOutputModeMock.mockReset().mockReturnValue({
    effective: "obsidian-xml",
    source: "default",
  });
  vi.resetModules();
});

describe("responses nonstream handler", () => {
  it("sets and restores output mode header around chat handler", async () => {
    const { postResponsesNonStream } = await import(
      "../../../../src/handlers/responses/nonstream.js"
    );
    const req = makeReq({ input: "hello" });
    const res = makeRes();
    postChatNonStreamMock.mockImplementation(async (callReq) => {
      expect(callReq.headers["x-proxy-output-mode"]).toBe("obsidian-xml");
    });

    await postResponsesNonStream(req, res);

    expect(req.headers["x-proxy-output-mode"]).toBeUndefined();
  });

  it("returns 400 when n is invalid", async () => {
    const { postResponsesNonStream } = await import(
      "../../../../src/handlers/responses/nonstream.js"
    );
    const req = makeReq({ input: "hello", n: "nope" });
    const res = makeRes();

    await postResponsesNonStream(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(postChatNonStreamMock).not.toHaveBeenCalled();
  });

  it("accepts numeric-string n and strips responses-only fields", async () => {
    process.env.PROXY_RESPONSES_DEFAULT_MAX_TOKENS = "64";
    const { postResponsesNonStream } = await import(
      "../../../../src/handlers/responses/nonstream.js"
    );
    const req = makeReq({
      input: "hello",
      n: "2",
      instructions: "do it",
      previous_response_id: "resp-1",
    });
    const res = makeRes();
    postChatNonStreamMock.mockImplementation(async (callReq) => {
      expect(callReq.body.n).toBe(2);
      expect(callReq.body.max_tokens).toBe(64);
      expect(callReq.body.instructions).toBeUndefined();
      expect(callReq.body.input).toBeUndefined();
      expect(callReq.body.previous_response_id).toBeUndefined();
    });

    await postResponsesNonStream(req, res);

    expect(postChatNonStreamMock).toHaveBeenCalled();
  });

  it("returns 400 when n exceeds max choices", async () => {
    process.env.PROXY_MAX_CHAT_CHOICES = "1";
    const { postResponsesNonStream } = await import(
      "../../../../src/handlers/responses/nonstream.js"
    );
    const req = makeReq({ input: "hello", n: 2 });
    const res = makeRes();

    await postResponsesNonStream(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ param: "n" }) })
    );
  });

  it("respects explicit max_tokens when fallback default is set", async () => {
    process.env.PROXY_RESPONSES_DEFAULT_MAX_TOKENS = "64";
    const { postResponsesNonStream } = await import(
      "../../../../src/handlers/responses/nonstream.js"
    );
    const req = makeReq({ input: "hello", max_tokens: 12 });
    const res = makeRes();
    postChatNonStreamMock.mockImplementation(async (callReq) => {
      expect(callReq.body.max_tokens).toBe(12);
    });

    await postResponsesNonStream(req, res);

    expect(postChatNonStreamMock).toHaveBeenCalled();
  });

  it("captures transformed responses and logs summaries", async () => {
    const { postResponsesNonStream } = await import(
      "../../../../src/handlers/responses/nonstream.js"
    );
    const req = makeReq({ input: "hello" });
    const res = makeRes();
    postChatNonStreamMock.mockImplementation(async (_req, callRes) => {
      callRes.locals.responseTransform(
        { id: "chatcmpl-1", model: "gpt-test", choices: [{ message: { content: "hi" } }] },
        200
      );
    });

    await postResponsesNonStream(req, res);

    expect(convertChatResponseToResponsesMock).toHaveBeenCalled();
    expect(captureResponsesNonStreamMock).toHaveBeenCalled();
    expect(logStructuredMock).toHaveBeenCalled();
  });

  it("skips transformation when status is an error", async () => {
    const { postResponsesNonStream } = await import(
      "../../../../src/handlers/responses/nonstream.js"
    );
    const req = makeReq({ input: "hello" });
    const res = makeRes();
    postChatNonStreamMock.mockImplementation(async (_req, callRes) => {
      const payload = { error: { message: "nope" } };
      const transformed = callRes.locals.responseTransform(payload, 500);
      expect(transformed).toBe(payload);
    });

    await postResponsesNonStream(req, res);

    expect(convertChatResponseToResponsesMock).not.toHaveBeenCalled();
    expect(captureResponsesNonStreamMock).not.toHaveBeenCalled();
  });

  it("summarizes text and tool output from transformed responses", async () => {
    const { postResponsesNonStream } = await import(
      "../../../../src/handlers/responses/nonstream.js"
    );
    const req = makeReq({ input: "hello" });
    const res = makeRes();
    const transformed = {
      id: "resp-1",
      model: "gpt-test",
      status: "completed",
      output: [
        {
          type: "message",
          content: [
            { type: "output_text", text: "hello" },
            { type: "text", text: "world" },
          ],
        },
        { type: "tool_use", name: "do_it" },
      ],
    };
    convertChatResponseToResponsesMock.mockReturnValueOnce(transformed);
    postChatNonStreamMock.mockImplementation(async (_req, callRes) => {
      callRes.locals.responseTransform(
        { id: "chatcmpl-1", model: "gpt-test", choices: [{ message: { content: "hi" } }] },
        200
      );
    });

    await postResponsesNonStream(req, res);

    expect(summarizeTextPartsMock).toHaveBeenCalledWith(["hello", "world"]);
    expect(summarizeToolUseItemsMock).toHaveBeenCalledWith(transformed.output);
  });

  it("skips error response when headers have already been sent", async () => {
    const { postResponsesNonStream } = await import(
      "../../../../src/handlers/responses/nonstream.js"
    );
    const req = makeReq({ input: "hello" });
    const res = makeRes();
    res.headersSent = true;
    postChatNonStreamMock.mockRejectedValueOnce(new Error("boom"));

    await postResponsesNonStream(req, res);

    expect(res.json).not.toHaveBeenCalled();
  });

  it("cleans up listeners when res.off is unavailable", async () => {
    const { postResponsesNonStream } = await import(
      "../../../../src/handlers/responses/nonstream.js"
    );
    const req = makeReq({ input: "hello" });
    const res = makeRes();
    res.off = undefined;
    const removeListenerSpy = vi.spyOn(res, "removeListener");

    await postResponsesNonStream(req, res);
    res.emit("finish");

    expect(removeListenerSpy).toHaveBeenCalled();
  });

  it("maps thrown errors to responses error payloads", async () => {
    const { postResponsesNonStream } = await import(
      "../../../../src/handlers/responses/nonstream.js"
    );
    const req = makeReq({ input: "hello" });
    const res = makeRes();
    postChatNonStreamMock.mockRejectedValueOnce({
      message: "nope",
      statusCode: 418,
      code: "teapot",
      type: "server_error",
    });

    await postResponsesNonStream(req, res);

    expect(res.status).toHaveBeenCalledWith(418);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        message: "nope",
        type: "server_error",
        code: "teapot",
      },
    });
  });
});
