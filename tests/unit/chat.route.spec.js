import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

const configMock = {
  PROXY_DEFAULT_STREAM: false,
};

const postChatStreamMock = vi.fn();
const postChatNonStreamMock = vi.fn();
const requireStrictAuthMock = vi.fn((_req, _res, next) => next());
const requireWorkerReadyMock = vi.fn((_req, _res, next) => next());
const maybeHandleTitleInterceptMock = vi.fn();

vi.mock("../../src/config/index.js", () => ({
  config: configMock,
}));

vi.mock("../../src/handlers/chat/stream.js", () => ({
  postChatStream: (...args) => postChatStreamMock(...args),
}));

vi.mock("../../src/handlers/chat/nonstream.js", () => ({
  postChatNonStream: (...args) => postChatNonStreamMock(...args),
}));

vi.mock("../../src/middleware/auth.js", () => ({
  requireStrictAuth: (...args) => requireStrictAuthMock(...args),
}));

vi.mock("../../src/middleware/worker-ready.js", () => ({
  requireWorkerReady: (...args) => requireWorkerReadyMock(...args),
}));

vi.mock("../../src/lib/title-intercept.js", () => ({
  maybeHandleTitleIntercept: (...args) => maybeHandleTitleInterceptMock(...args),
}));

const startApp = async () => {
  const { default: chatRouter } = await import("../../src/routes/chat.js");
  const app = express();
  app.use(express.json());
  app.use(chatRouter());
  const server = app.listen(0);
  const port = server.address().port;
  return { server, port };
};

beforeEach(() => {
  configMock.PROXY_DEFAULT_STREAM = false;
  postChatStreamMock.mockReset();
  postChatNonStreamMock.mockReset();
  requireStrictAuthMock.mockReset();
  requireWorkerReadyMock.mockReset();
  maybeHandleTitleInterceptMock.mockReset().mockResolvedValue(false);
});

afterEach(() => {
  vi.resetModules();
});

describe("chat router", () => {
  it("responds to HEAD with json content type", async () => {
    const { server, port } = await startApp();
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "HEAD",
    });
    server.close();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(requireStrictAuthMock).toHaveBeenCalled();
  });

  it("routes stream requests to postChatStream", async () => {
    postChatStreamMock.mockImplementation((_req, res) => {
      res.status(200).json({ stream: true });
    });

    const { server, port } = await startApp();
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-test", stream: true }),
    });
    const body = await res.json();
    server.close();

    expect(res.status).toBe(200);
    expect(body.stream).toBe(true);
    expect(requireWorkerReadyMock).toHaveBeenCalled();
    expect(postChatStreamMock).toHaveBeenCalled();
    expect(postChatNonStreamMock).not.toHaveBeenCalled();
  });

  it("uses default stream when stream not provided", async () => {
    configMock.PROXY_DEFAULT_STREAM = true;
    postChatStreamMock.mockImplementation((_req, res) => {
      res.status(200).json({ stream: "default" });
    });

    const { server, port } = await startApp();
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-test" }),
    });
    const body = await res.json();
    server.close();

    expect(res.status).toBe(200);
    expect(body.stream).toBe("default");
    expect(postChatStreamMock).toHaveBeenCalled();
    expect(postChatNonStreamMock).not.toHaveBeenCalled();
  });

  it("respects explicit stream=false even when default true", async () => {
    configMock.PROXY_DEFAULT_STREAM = true;
    postChatNonStreamMock.mockImplementation((_req, res) => {
      res.status(200).json({ stream: false });
    });

    const { server, port } = await startApp();
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-test", stream: false }),
    });
    const body = await res.json();
    server.close();

    expect(res.status).toBe(200);
    expect(body.stream).toBe(false);
    expect(postChatNonStreamMock).toHaveBeenCalled();
    expect(postChatStreamMock).not.toHaveBeenCalled();
  });

  it("short-circuits when title intercept handles the request", async () => {
    maybeHandleTitleInterceptMock.mockImplementation(async ({ res }) => {
      res.status(200).json({ intercepted: true });
      return true;
    });

    const { server, port } = await startApp();
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-test" }),
    });
    const body = await res.json();
    server.close();

    expect(res.status).toBe(200);
    expect(body.intercepted).toBe(true);
    expect(requireWorkerReadyMock).not.toHaveBeenCalled();
    expect(postChatStreamMock).not.toHaveBeenCalled();
    expect(postChatNonStreamMock).not.toHaveBeenCalled();
  });
});
