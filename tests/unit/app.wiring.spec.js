import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const applyCorsMock = vi.fn();
const accessLogMock = vi.fn(() => (_req, _res, next) => next());
const metricsMiddlewareMock = vi.fn(() => (_req, _res, next) => next());
const tracingMiddlewareMock = vi.fn(() => (_req, _res, next) => next());
const rateLimitMock = vi.fn(() => (_req, _res, next) => next());
const logStructuredMock = vi.fn();
const guardSnapshotMock = vi.fn(() => 3);
const toolBufferSummaryMock = vi.fn(() => ({ calls: 0 }));
const toolBufferResetMock = vi.fn();
const requireTestAuthMock = vi.fn((_req, _res, next) => next());
const writeFileMock = vi.fn();
const healthRouterMock = vi.fn(() => (_req, _res, next) => next());
const modelsRouterMock = vi.fn(() => (_req, _res, next) => next());
const chatRouterMock = vi.fn(() => (_req, _res, next) => next());
const responsesRouterMock = vi.fn(() => (_req, _res, next) => next());
const usageRouterMock = vi.fn(() => (_req, _res, next) => next());
const metricsRouterMock = vi.fn(() => (_req, _res, next) => next());

const configMock = {
  PROXY_TRUST_PROXY: "loopback",
  PROXY_ENABLE_CORS: "true",
  PROXY_CORS_ALLOWED_ORIGINS: "*",
  PROXY_LOG_CORS_ORIGIN: false,
  PROXY_RATE_LIMIT_ENABLED: false,
  PROXY_RATE_LIMIT_WINDOW_MS: 60000,
  PROXY_RATE_LIMIT_MAX: 1000,
  PROXY_TEST_ENDPOINTS: false,
  PROXY_ENABLE_METRICS: false,
  PROXY_ENABLE_RESPONSES: true,
};

vi.mock("../../src/utils.js", () => ({
  applyCors: (...args) => applyCorsMock(...args),
}));

vi.mock("../../src/middleware/access-log.js", () => ({
  default: accessLogMock,
}));

vi.mock("../../src/middleware/metrics.js", () => ({
  default: metricsMiddlewareMock,
}));

vi.mock("../../src/middleware/tracing.js", () => ({
  default: tracingMiddlewareMock,
}));

vi.mock("../../src/middleware/rate-limit.js", () => ({
  default: (...args) => rateLimitMock(...args),
}));

vi.mock("../../src/services/logging/schema.js", () => ({
  logStructured: (...args) => logStructuredMock(...args),
}));

vi.mock("../../src/services/concurrency-guard.js", () => ({
  guardSnapshot: (...args) => guardSnapshotMock(...args),
}));

vi.mock("../../src/services/metrics/chat.js", () => ({
  toolBufferMetrics: {
    summary: (...args) => toolBufferSummaryMock(...args),
    reset: (...args) => toolBufferResetMock(...args),
  },
}));

vi.mock("../../src/middleware/auth.js", () => ({
  requireTestAuth: (...args) => requireTestAuthMock(...args),
}));

vi.mock("node:fs/promises", () => ({
  default: { writeFile: (...args) => writeFileMock(...args) },
  writeFile: (...args) => writeFileMock(...args),
}));

vi.mock("../../src/config/index.js", () => ({
  config: configMock,
}));

vi.mock("../../src/routes/health.js", () => ({
  default: () => healthRouterMock(),
}));

vi.mock("../../src/routes/models.js", () => ({
  default: () => modelsRouterMock(),
}));

vi.mock("../../src/routes/chat.js", () => ({
  default: () => chatRouterMock(),
}));

vi.mock("../../src/routes/responses.js", () => ({
  default: () => responsesRouterMock(),
}));

vi.mock("../../src/routes/usage.js", () => ({
  default: () => usageRouterMock(),
}));

vi.mock("../../src/routes/metrics.js", () => ({
  default: () => metricsRouterMock(),
}));

const startServer = async () => {
  const { default: createApp } = await import("../../src/app.js");
  const app = createApp();
  const server = app.listen(0);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  return { server, baseUrl };
};

const getErrorHandlers = async () => {
  const { default: createApp } = await import("../../src/app.js");
  const app = createApp();
  return app._router.stack
    .filter((layer) => layer.handle?.length === 4)
    .map((layer) => layer.handle);
};

beforeEach(() => {
  configMock.PROXY_ENABLE_CORS = "true";
  configMock.PROXY_CORS_ALLOWED_ORIGINS = "*";
  configMock.PROXY_LOG_CORS_ORIGIN = false;
  configMock.PROXY_RATE_LIMIT_ENABLED = false;
  configMock.PROXY_RATE_LIMIT_WINDOW_MS = 60000;
  configMock.PROXY_RATE_LIMIT_MAX = 1000;
  configMock.PROXY_TEST_ENDPOINTS = false;
  configMock.PROXY_ENABLE_METRICS = false;
  configMock.PROXY_ENABLE_RESPONSES = true;

  applyCorsMock.mockReset();
  accessLogMock.mockClear();
  metricsMiddlewareMock.mockClear();
  tracingMiddlewareMock.mockClear();
  rateLimitMock.mockClear();
  logStructuredMock.mockReset();
  guardSnapshotMock.mockReset().mockReturnValue(3);
  toolBufferSummaryMock.mockReset().mockReturnValue({ calls: 0 });
  toolBufferResetMock.mockReset();
  requireTestAuthMock.mockReset().mockImplementation((_req, _res, next) => next());
  writeFileMock.mockReset();
  healthRouterMock.mockReset();
  modelsRouterMock.mockReset();
  chatRouterMock.mockReset();
  responsesRouterMock.mockReset();
  usageRouterMock.mockReset();
  metricsRouterMock.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe("createApp wiring", () => {
  it("configures rate limit middleware from config", async () => {
    configMock.PROXY_RATE_LIMIT_ENABLED = true;
    configMock.PROXY_RATE_LIMIT_WINDOW_MS = 1234;
    configMock.PROXY_RATE_LIMIT_MAX = 42;

    const { default: createApp } = await import("../../src/app.js");
    createApp();

    expect(rateLimitMock).toHaveBeenCalledWith({
      enabled: true,
      windowMs: 1234,
      max: 42,
    });
  });

  it("mounts metrics router only when enabled", async () => {
    configMock.PROXY_ENABLE_METRICS = false;
    const { default: createApp } = await import("../../src/app.js");
    createApp();
    expect(metricsRouterMock).not.toHaveBeenCalled();

    vi.resetModules();
    metricsRouterMock.mockReset();
    configMock.PROXY_ENABLE_METRICS = true;
    const { default: createAppEnabled } = await import("../../src/app.js");
    createAppEnabled();
    expect(metricsRouterMock).toHaveBeenCalledTimes(1);
  });

  it("mounts responses router only when enabled", async () => {
    configMock.PROXY_ENABLE_RESPONSES = false;
    const { default: createApp } = await import("../../src/app.js");
    createApp();
    expect(responsesRouterMock).not.toHaveBeenCalled();

    vi.resetModules();
    responsesRouterMock.mockReset();
    configMock.PROXY_ENABLE_RESPONSES = true;
    const { default: createAppEnabled } = await import("../../src/app.js");
    createAppEnabled();
    expect(responsesRouterMock).toHaveBeenCalledTimes(1);
  });

  it("returns 204 for CORS preflight and logs origin when enabled", async () => {
    configMock.PROXY_LOG_CORS_ORIGIN = true;

    const { server, baseUrl } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "OPTIONS",
        headers: {
          origin: "https://example.com",
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type",
          "user-agent": "vitest",
        },
      });

      expect(res.status).toBe(204);
      expect(applyCorsMock).toHaveBeenCalled();
      expect(logStructuredMock).toHaveBeenCalled();
      const [meta, extra] = logStructuredMock.mock.calls[0];
      expect(meta.event).toBe("cors_preflight");
      expect(extra.origin).toBe("https://example.com");
    } finally {
      server.close();
    }
  });

  it("returns JSON body parser errors", async () => {
    const { server, baseUrl } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: "{ invalid",
      });

      expect(res.status).toBe(400);
      const payload = await res.json();
      expect(payload.error.code).toBe("invalid_json");
    } finally {
      server.close();
    }
  });

  it("serves test-only endpoints when enabled", async () => {
    configMock.PROXY_TEST_ENDPOINTS = true;
    const { server, baseUrl } = await startServer();
    try {
      const concRes = await fetch(`${baseUrl}/__test/conc`);
      expect(concRes.status).toBe(200);
      const concPayload = await concRes.json();
      expect(concPayload.conc).toBe(3);

      const metricsRes = await fetch(`${baseUrl}/__test/tool-buffer-metrics`);
      expect(metricsRes.status).toBe(200);
      const metricsPayload = await metricsRes.json();
      expect(metricsPayload.summary).toEqual({ calls: 0 });

      const resetRes = await fetch(`${baseUrl}/__test/tool-buffer-metrics/reset`, {
        method: "POST",
      });
      const resetPayload = await resetRes.json();
      expect(resetPayload.ok).toBe(true);
      expect(toolBufferResetMock).toHaveBeenCalled();
    } finally {
      server.close();
    }
  });

  it("returns 400 when test release path is missing", async () => {
    configMock.PROXY_TEST_ENDPOINTS = true;
    const prevReleasePath = process.env.STREAM_RELEASE_FILE;
    delete process.env.STREAM_RELEASE_FILE;

    const { server, baseUrl } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/__test/conc/release`, {
        method: "POST",
      });
      expect(res.status).toBe(400);
      const payload = await res.json();
      expect(payload.reason).toBe("STREAM_RELEASE_FILE not set");
    } finally {
      if (prevReleasePath === undefined) {
        delete process.env.STREAM_RELEASE_FILE;
      } else {
        process.env.STREAM_RELEASE_FILE = prevReleasePath;
      }
      server.close();
    }
  });

  it("returns 500 when test release write fails", async () => {
    configMock.PROXY_TEST_ENDPOINTS = true;
    const prevReleasePath = process.env.STREAM_RELEASE_FILE;
    process.env.STREAM_RELEASE_FILE = "/tmp/release.txt";
    writeFileMock.mockRejectedValue(new Error("boom"));

    const { server, baseUrl } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/__test/conc/release`, {
        method: "POST",
      });
      expect(res.status).toBe(500);
      const payload = await res.json();
      expect(payload.error).toBe("boom");
    } finally {
      if (prevReleasePath === undefined) {
        delete process.env.STREAM_RELEASE_FILE;
      } else {
        process.env.STREAM_RELEASE_FILE = prevReleasePath;
      }
      server.close();
    }
  });

  it("maps body parser errors to OpenAI-style responses", async () => {
    const [bodyParserHandler] = await getErrorHandlers();
    const req = { headers: {} };
    const res = {
      headersSent: false,
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    const next = vi.fn();

    await bodyParserHandler({ status: 413, type: "entity.too.large" }, req, res, next);
    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json.mock.calls[0][0].error.code).toBe("request_entity_too_large");

    res.status.mockClear();
    res.json.mockClear();
    await bodyParserHandler({ statusCode: 415, type: "charset.unsupported" }, req, res, next);
    expect(res.status).toHaveBeenCalledWith(415);
    expect(res.json.mock.calls[0][0].error.code).toBe("unsupported_encoding");

    res.status.mockClear();
    res.json.mockClear();
    await bodyParserHandler({ status: 499, type: "request.aborted" }, req, res, next);
    expect(res.status).toHaveBeenCalledWith(499);
    expect(res.json.mock.calls[0][0].error.code).toBe("request_aborted");
  });

  it("passes non-body-parser errors through", async () => {
    const [bodyParserHandler] = await getErrorHandlers();
    const req = { headers: {} };
    const res = {
      headersSent: false,
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    const next = vi.fn();
    const err = { status: 500, type: "boom" };

    await bodyParserHandler(err, req, res, next);

    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns JSON errors from the final handler", async () => {
    const [, finalHandler] = await getErrorHandlers();
    const req = { headers: {} };
    const res = {
      headersSent: false,
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    const next = vi.fn();

    await finalHandler({ statusCode: 418, message: "teapot" }, req, res, next);
    expect(res.status).toHaveBeenCalledWith(418);
    expect(res.json.mock.calls[0][0].error.message).toBe("teapot");

    res.status.mockClear();
    res.json.mockClear();
    await finalHandler({ status: 700 }, req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].error.code).toBe("internal_error");
  });
});
