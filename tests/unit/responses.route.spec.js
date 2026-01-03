import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

const postResponsesStreamMock = vi.fn();
const postResponsesNonStreamMock = vi.fn();
const requireStrictAuthMock = vi.fn((_req, _res, next) => next());
const requireWorkerReadyMock = vi.fn((_req, _res, next) => next());
const maybeHandleTitleSummaryInterceptMock = vi.fn();

vi.mock("../../src/handlers/responses/stream.js", () => ({
  postResponsesStream: (...args) => postResponsesStreamMock(...args),
}));

vi.mock("../../src/handlers/responses/nonstream.js", () => ({
  postResponsesNonStream: (...args) => postResponsesNonStreamMock(...args),
}));

vi.mock("../../src/middleware/auth.js", () => ({
  requireStrictAuth: (...args) => requireStrictAuthMock(...args),
}));

vi.mock("../../src/middleware/worker-ready.js", () => ({
  requireWorkerReady: (...args) => requireWorkerReadyMock(...args),
}));

vi.mock("../../src/handlers/responses/title-summary-intercept.js", () => ({
  maybeHandleTitleSummaryIntercept: (...args) => maybeHandleTitleSummaryInterceptMock(...args),
}));

const startApp = async () => {
  const { default: responsesRouter } = await import("../../src/routes/responses.js");
  const app = express();
  app.use(express.json());
  app.use(responsesRouter());
  const server = app.listen(0);
  const port = server.address().port;
  return { server, port };
};

beforeEach(() => {
  postResponsesStreamMock.mockReset();
  postResponsesNonStreamMock.mockReset();
  requireStrictAuthMock.mockReset();
  requireWorkerReadyMock.mockReset();
  maybeHandleTitleSummaryInterceptMock.mockReset().mockResolvedValue(false);
});

afterEach(() => {
  vi.resetModules();
});

describe("responses router", () => {
  it("responds to HEAD with json content type", async () => {
    const { server, port } = await startApp();
    const res = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
      method: "HEAD",
    });
    server.close();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(requireStrictAuthMock).toHaveBeenCalled();
    expect(requireWorkerReadyMock).toHaveBeenCalled();
  });

  it("routes stream requests to postResponsesStream", async () => {
    postResponsesStreamMock.mockImplementation((_req, res) => {
      res.status(200).json({ stream: true });
    });

    const { server, port } = await startApp();
    const res = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: [], stream: true }),
    });
    const body = await res.json();
    server.close();

    expect(res.status).toBe(200);
    expect(body.stream).toBe(true);
    expect(requireWorkerReadyMock).toHaveBeenCalled();
    expect(postResponsesStreamMock).toHaveBeenCalled();
    expect(postResponsesNonStreamMock).not.toHaveBeenCalled();
  });

  it("routes nonstream requests to postResponsesNonStream", async () => {
    postResponsesNonStreamMock.mockImplementation((_req, res) => {
      res.status(200).json({ stream: false });
    });

    const { server, port } = await startApp();
    const res = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: [], stream: false }),
    });
    const body = await res.json();
    server.close();

    expect(res.status).toBe(200);
    expect(body.stream).toBe(false);
    expect(requireWorkerReadyMock).toHaveBeenCalled();
    expect(postResponsesNonStreamMock).toHaveBeenCalled();
    expect(postResponsesStreamMock).not.toHaveBeenCalled();
  });

  it("short-circuits when title summary intercept handles the request", async () => {
    maybeHandleTitleSummaryInterceptMock.mockImplementation(async ({ res }) => {
      res.status(200).json({ intercepted: true });
      return true;
    });

    const { server, port } = await startApp();
    const res = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: [] }),
    });
    const body = await res.json();
    server.close();

    expect(res.status).toBe(200);
    expect(body.intercepted).toBe(true);
    expect(requireWorkerReadyMock).not.toHaveBeenCalled();
    expect(postResponsesStreamMock).not.toHaveBeenCalled();
    expect(postResponsesNonStreamMock).not.toHaveBeenCalled();
  });
});
