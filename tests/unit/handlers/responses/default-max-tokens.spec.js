import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const postChatStreamMock = vi.fn();
const postChatNonStreamMock = vi.fn();
const logResponsesIngressRawMock = vi.fn();

vi.mock("../../../../src/handlers/chat/stream.js", () => ({
  postChatStream: (...args) => postChatStreamMock(...args),
}));

vi.mock("../../../../src/handlers/chat/nonstream.js", () => ({
  postChatNonStream: (...args) => postChatNonStreamMock(...args),
}));

vi.mock("../../../../src/handlers/responses/ingress-logging.js", () => ({
  logResponsesIngressRaw: (...args) => logResponsesIngressRawMock(...args),
}));

const originalDefaultMax = process.env.PROXY_RESPONSES_DEFAULT_MAX_TOKENS;

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
  res.json = vi.fn();
  res.write = vi.fn();
  res.writableEnded = false;
  return res;
};

afterEach(() => {
  if (originalDefaultMax === undefined) {
    delete process.env.PROXY_RESPONSES_DEFAULT_MAX_TOKENS;
  } else {
    process.env.PROXY_RESPONSES_DEFAULT_MAX_TOKENS = originalDefaultMax;
  }
  postChatStreamMock.mockReset();
  postChatNonStreamMock.mockReset();
  logResponsesIngressRawMock.mockReset();
  vi.resetModules();
});

describe("responses default max tokens", () => {
  it("injects max_tokens for stream requests when missing", async () => {
    process.env.PROXY_RESPONSES_DEFAULT_MAX_TOKENS = "128";
    vi.resetModules();
    const { postResponsesStream } = await import("../../../../src/handlers/responses/stream.js");
    let captured;
    postChatStreamMock.mockImplementation(async (req) => {
      captured = req.body;
    });

    await postResponsesStream(makeReq({ input: "hello" }), makeRes());
    expect(captured?.max_tokens).toBe(128);
  });

  it("does not override max_tokens for stream requests", async () => {
    process.env.PROXY_RESPONSES_DEFAULT_MAX_TOKENS = "128";
    vi.resetModules();
    const { postResponsesStream } = await import("../../../../src/handlers/responses/stream.js");
    let captured;
    postChatStreamMock.mockImplementation(async (req) => {
      captured = req.body;
    });

    await postResponsesStream(makeReq({ input: "hello", max_tokens: 7 }), makeRes());
    expect(captured?.max_tokens).toBe(7);
  });

  it("injects max_tokens for non-stream requests when missing", async () => {
    process.env.PROXY_RESPONSES_DEFAULT_MAX_TOKENS = "128";
    vi.resetModules();
    const { postResponsesNonStream } = await import(
      "../../../../src/handlers/responses/nonstream.js"
    );
    let captured;
    postChatNonStreamMock.mockImplementation(async (req) => {
      captured = req.body;
    });

    await postResponsesNonStream(makeReq({ input: "hello" }), makeRes());
    expect(captured?.max_tokens).toBe(128);
  });

  it("does not override maxOutputTokens for non-stream requests", async () => {
    process.env.PROXY_RESPONSES_DEFAULT_MAX_TOKENS = "128";
    vi.resetModules();
    const { postResponsesNonStream } = await import(
      "../../../../src/handlers/responses/nonstream.js"
    );
    let captured;
    postChatNonStreamMock.mockImplementation(async (req) => {
      captured = req.body;
    });

    await postResponsesNonStream(makeReq({ input: "hello", maxOutputTokens: 9 }), makeRes());
    expect(captured?.maxOutputTokens).toBe(9);
    expect(captured?.max_tokens).toBeUndefined();
  });
});
