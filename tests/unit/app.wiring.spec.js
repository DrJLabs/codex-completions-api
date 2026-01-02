import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const applyCorsMock = vi.fn();
const accessLogMock = vi.fn(() => (_req, _res, next) => next());
const metricsMiddlewareMock = vi.fn(() => (_req, _res, next) => next());
const tracingMiddlewareMock = vi.fn(() => (_req, _res, next) => next());
const rateLimitMock = vi.fn(() => (_req, _res, next) => next());
const logStructuredMock = vi.fn();
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
});
