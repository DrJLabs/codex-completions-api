import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

const readFileMock = vi.fn();
const parseTimeMock = vi.fn();
const aggregateUsageMock = vi.fn();
const toolBufferSummaryMock = vi.fn();
const requireUsageAuthMock = vi.fn((req, res, next) => next());

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: (...args) => readFileMock(...args),
  },
  readFile: (...args) => readFileMock(...args),
}));

vi.mock("../../src/utils.js", () => ({
  parseTime: (...args) => parseTimeMock(...args),
  aggregateUsage: (...args) => aggregateUsageMock(...args),
}));

vi.mock("../../src/services/metrics/chat.js", () => ({
  toolBufferMetrics: {
    summary: () => toolBufferSummaryMock(),
  },
}));

vi.mock("../../src/middleware/auth.js", () => ({
  requireUsageAuth: (...args) => requireUsageAuthMock(...args),
}));

const startApp = async () => {
  const { default: usageRouter } = await import("../../src/routes/usage.js");
  const app = express();
  app.use(usageRouter());
  const server = app.listen(0);
  const port = server.address().port;
  return { server, port };
};

beforeEach(() => {
  readFileMock.mockReset();
  parseTimeMock.mockReset();
  aggregateUsageMock.mockReset();
  toolBufferSummaryMock.mockReset();
  requireUsageAuthMock.mockClear();
  delete process.env.TOKEN_LOG_PATH;
});

afterEach(() => {
  vi.resetModules();
});

describe("usage router", () => {
  it("aggregates usage and attaches tool buffer metrics", async () => {
    process.env.TOKEN_LOG_PATH = "/tmp/usage.ndjson";
    readFileMock.mockResolvedValue(['{"ts":1}', "not-json", '{"ts":2}', ""].join("\n"));
    parseTimeMock.mockReturnValueOnce(10).mockReturnValueOnce(20);
    aggregateUsageMock.mockReturnValue({ ok: true, count: 2 });
    toolBufferSummaryMock.mockReturnValue({ started: { total: 0, buckets: [] } });
    vi.resetModules();

    const { server, port } = await startApp();
    const res = await fetch(`http://127.0.0.1:${port}/v1/usage?start=1&end=2&group=route`);
    const body = await res.json();
    server.close();

    expect(res.status).toBe(200);
    expect(readFileMock).toHaveBeenCalledWith("/tmp/usage.ndjson", "utf8");
    expect(parseTimeMock).toHaveBeenCalledWith("1");
    expect(parseTimeMock).toHaveBeenCalledWith("2");
    expect(aggregateUsageMock).toHaveBeenCalledWith(
      expect.arrayContaining([{ ts: 1 }, { ts: 2 }]),
      10,
      20,
      "route"
    );
    expect(body).toEqual({
      ok: true,
      count: 2,
      tool_buffer_metrics: { started: { total: 0, buckets: [] } },
    });
  });

  it("returns raw usage with bounded limit", async () => {
    process.env.TOKEN_LOG_PATH = "/tmp/usage.ndjson";
    readFileMock.mockResolvedValue(['{"id":1}', '{"id":2}', '{"id":3}'].join("\n"));
    toolBufferSummaryMock.mockReturnValue({ started: { total: 0, buckets: [] } });
    vi.resetModules();

    const { server, port } = await startApp();
    const res = await fetch(`http://127.0.0.1:${port}/v1/usage/raw?limit=1`);
    const body = await res.json();
    server.close();

    expect(res.status).toBe(200);
    expect(body.count).toBe(1);
    expect(body.events).toEqual([{ id: 3 }]);
    expect(body.tool_buffer_metrics).toEqual({ started: { total: 0, buckets: [] } });
  });

  it("returns empty results when TOKEN_LOG_PATH is missing", async () => {
    process.env.TOKEN_LOG_PATH = "/tmp/missing.ndjson";
    const error = new Error("missing");
    error.code = "ENOENT";
    readFileMock.mockRejectedValue(error);
    toolBufferSummaryMock.mockReturnValue({ started: { total: 0, buckets: [] } });
    vi.resetModules();

    const { server, port } = await startApp();
    const res = await fetch(`http://127.0.0.1:${port}/v1/usage/raw`);
    const body = await res.json();
    server.close();

    expect(res.status).toBe(200);
    expect(body.count).toBe(0);
    expect(body.events).toEqual([]);
  });
});
