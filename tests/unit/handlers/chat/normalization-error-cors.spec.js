import { beforeEach, describe, expect, test, vi } from "vitest";

const applyCorsMock = vi.fn();
const normalizeChatJsonRpcRequestMock = vi.fn();

vi.mock("../../../../src/utils.js", async () => {
  const actual = await vi.importActual("../../../../src/utils.js");
  return {
    ...actual,
    applyCors: (...args) => applyCorsMock(...args),
  };
});

vi.mock("../../../../src/handlers/chat/request.js", async () => {
  const actual = await vi.importActual("../../../../src/handlers/chat/request.js");
  return {
    ...actual,
    normalizeChatJsonRpcRequest: (...args) => normalizeChatJsonRpcRequestMock(...args),
  };
});

const { postChatNonStream } = await import("../../../../src/handlers/chat/nonstream.js");
const { postChatStream } = await import("../../../../src/handlers/chat/stream.js");

const createReq = () => ({
  body: {
    model: "gpt-5.2",
    messages: [{ role: "user", content: "ping" }],
  },
  headers: {},
  query: {},
});

const createRes = () => ({
  locals: {},
  statusCode: 200,
  setHeader: vi.fn(),
  getHeader: vi.fn(),
  set: vi.fn(),
  status: vi.fn(function status(code) {
    this.statusCode = code;
    return this;
  }),
  json: vi.fn(),
  writeHead: vi.fn(),
  end: vi.fn(),
});

describe("chat normalization unexpected errors", () => {
  beforeEach(() => {
    applyCorsMock.mockReset();
    normalizeChatJsonRpcRequestMock.mockReset();
  });

  test("nonstream applies CORS before rethrowing unexpected normalization errors", async () => {
    normalizeChatJsonRpcRequestMock.mockImplementation(() => {
      throw new Error("boom");
    });
    const req = createReq();
    const res = createRes();

    await expect(postChatNonStream(req, res)).rejects.toThrow("boom");
    expect(applyCorsMock).toHaveBeenCalled();
  });

  test("stream applies CORS before rethrowing unexpected normalization errors", async () => {
    normalizeChatJsonRpcRequestMock.mockImplementation(() => {
      throw new Error("boom");
    });
    const req = createReq();
    const res = createRes();

    await expect(postChatStream(req, res)).rejects.toThrow("boom");
    expect(applyCorsMock).toHaveBeenCalled();
  });
});
