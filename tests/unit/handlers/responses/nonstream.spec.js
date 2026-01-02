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
