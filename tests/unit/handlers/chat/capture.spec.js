import { beforeEach, describe, expect, it, vi } from "vitest";

const mkdirMock = vi.fn();
const writeFileMock = vi.fn();
const sanitizeCaptureIdMock = vi.fn();
const createCaptureSanitizersMock = vi.fn();
const ensureCopilotTraceContextMock = vi.fn();
const configMock = {
  PROXY_CAPTURE_CHAT_TRANSCRIPTS: false,
  PROXY_CAPTURE_CHAT_RAW_TRANSCRIPTS: false,
  PROXY_CAPTURE_CHAT_DIR: "/tmp/chat",
  PROXY_CAPTURE_CHAT_RAW_DIR: "/tmp/chat-raw",
};

let sanitizeValueMock;
let sanitizeHeadersMock;
let sanitizeHeadersRawMock;

vi.mock("node:fs/promises", () => ({
  mkdir: (...args) => mkdirMock(...args),
  writeFile: (...args) => writeFileMock(...args),
}));

vi.mock("../../../../src/config/index.js", () => ({
  config: configMock,
}));

vi.mock("../../../../src/lib/trace-ids.js", () => ({
  ensureCopilotTraceContext: (...args) => ensureCopilotTraceContextMock(...args),
}));

vi.mock("../../../../src/lib/capture/sanitize.js", async () => {
  const actual = await vi.importActual("../../../../src/lib/capture/sanitize.js");
  return {
    ...actual,
    createCaptureSanitizers: (...args) => createCaptureSanitizersMock(...args),
    sanitizeCaptureId: (...args) => sanitizeCaptureIdMock(...args),
  };
});

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

const loadCapture = async () => {
  vi.resetModules();
  return await import("../../../../src/handlers/chat/capture.js");
};

beforeEach(() => {
  configMock.PROXY_CAPTURE_CHAT_TRANSCRIPTS = false;
  configMock.PROXY_CAPTURE_CHAT_RAW_TRANSCRIPTS = false;
  configMock.PROXY_CAPTURE_CHAT_DIR = "/tmp/chat";
  configMock.PROXY_CAPTURE_CHAT_RAW_DIR = "/tmp/chat-raw";

  mkdirMock.mockReset().mockResolvedValue(undefined);
  writeFileMock.mockReset().mockResolvedValue(undefined);
  sanitizeCaptureIdMock
    .mockReset()
    .mockImplementation((value) =>
      typeof value === "string" ? value.replace(/[^a-z0-9-]+/gi, "") : ""
    );

  sanitizeValueMock = vi.fn((value) => ({ sanitized: value }));
  sanitizeHeadersMock = vi.fn((value) => ({ sanitized: value }));
  sanitizeHeadersRawMock = vi.fn((value) => ({ raw: value }));
  createCaptureSanitizersMock.mockReset().mockReturnValue({
    sanitizeValue: sanitizeValueMock,
    sanitizeHeaders: sanitizeHeadersMock,
    sanitizeHeadersRaw: sanitizeHeadersRawMock,
  });
  ensureCopilotTraceContextMock.mockReset();
});

describe("chat capture", () => {
  it("returns early when capture is disabled", async () => {
    const { captureChatNonStream } = await loadCapture();

    captureChatNonStream({
      req: { headers: {} },
      res: { locals: {} },
      requestBody: { messages: [] },
      responseBody: { id: "resp" },
    });

    await flushPromises();

    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it("writes sanitized nonstream capture when enabled", async () => {
    configMock.PROXY_CAPTURE_CHAT_TRANSCRIPTS = true;
    const { captureChatNonStream } = await loadCapture();

    captureChatNonStream({
      req: { headers: { "x-proxy-capture-id": "demo" } },
      res: { locals: { req_id: "req-1" } },
      requestBody: { messages: [{ role: "user", content: "hi" }] },
      responseBody: { id: "resp" },
      outputModeEffective: "text",
    });

    await flushPromises();

    expect(writeFileMock).toHaveBeenCalledTimes(1);
    const [target, data] = writeFileMock.mock.calls[0];
    const payload = JSON.parse(String(data));

    expect(target).toContain("/tmp/chat");
    expect(target.endsWith("demo-nonstream.json")).toBe(true);
    expect(payload.metadata.scenario).toBe("demo-nonstream");
    expect(payload.metadata.stream).toBe(false);
    expect(payload.metadata.outcome).toBe("completed");
    expect(payload.request.headers).toEqual({
      sanitized: { "x-proxy-capture-id": "demo" },
    });
    expect(payload.request.body).toEqual({
      sanitized: { messages: [{ role: "user", content: "hi" }] },
    });
    expect(payload.response).toEqual({ sanitized: { id: "resp" } });
    expect(sanitizeHeadersMock).toHaveBeenCalledWith({ "x-proxy-capture-id": "demo" });
    expect(sanitizeValueMock).toHaveBeenCalledWith({ messages: [{ role: "user", content: "hi" }] });
    expect(sanitizeValueMock).toHaveBeenCalledWith({ id: "resp" });
  });

  it("writes raw nonstream capture when enabled", async () => {
    configMock.PROXY_CAPTURE_CHAT_RAW_TRANSCRIPTS = true;
    const { captureChatNonStream } = await loadCapture();

    captureChatNonStream({
      req: { headers: { "x-proxy-capture-id": "demo" } },
      res: { locals: {} },
      requestBody: { messages: [{ role: "user", content: "hi" }] },
      responseBody: { id: "resp" },
    });

    await flushPromises();

    expect(writeFileMock).toHaveBeenCalledTimes(1);
    const [target, data] = writeFileMock.mock.calls[0];
    const payload = JSON.parse(String(data));

    expect(target).toContain("/tmp/chat-raw");
    expect(target.endsWith("demo-nonstream.json")).toBe(true);
    expect(payload.request.headers).toEqual({ raw: { "x-proxy-capture-id": "demo" } });
    expect(payload.request.body).toEqual({ messages: [{ role: "user", content: "hi" }] });
    expect(payload.response).toEqual({ id: "resp" });
    expect(sanitizeHeadersRawMock).toHaveBeenCalledWith({ "x-proxy-capture-id": "demo" });
    expect(sanitizeHeadersMock).not.toHaveBeenCalled();
  });

  it("records and finalizes stream captures", async () => {
    configMock.PROXY_CAPTURE_CHAT_TRANSCRIPTS = true;
    const { createChatStreamCapture } = await loadCapture();

    const capture = createChatStreamCapture({
      req: { headers: { "x-proxy-capture-id": "demo" } },
      res: { locals: { req_id: "req-2" } },
      requestBody: { messages: [{ role: "user", content: "hi" }] },
      outputModeEffective: "text",
    });

    expect(ensureCopilotTraceContextMock).toHaveBeenCalledTimes(1);
    capture.record({ id: "chunk" });
    capture.recordDone();
    capture.finalize("failed");

    await flushPromises();

    expect(writeFileMock).toHaveBeenCalledTimes(1);
    const [, data] = writeFileMock.mock.calls[0];
    const payload = JSON.parse(String(data));

    expect(payload.metadata.scenario).toBe("demo-stream");
    expect(payload.metadata.outcome).toBe("failed");
    expect(payload.stream).toHaveLength(2);
    expect(payload.stream[0].type).toBe("data");
    expect(payload.stream[0].data).toEqual({ sanitized: { id: "chunk" } });
    expect(payload.stream[1].type).toBe("done");
  });
});
