import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

vi.mock("@opentelemetry/exporter-trace-otlp-http", () => ({
  OTLPTraceExporter: class {
    export(_spans, cb) {
      cb?.();
    }
    shutdown() {}
  },
}));

beforeEach(() => {
  Reflect.deleteProperty(globalThis, Symbol.for("opentelemetry.js.api.1.x"));
});

afterEach(() => {
  delete process.env.PROXY_ENABLE_OTEL;
  delete process.env.OTEL_ENABLED;
  delete process.env.PROXY_OTEL_EXPORTER_URL;
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  delete process.env.PROXY_OTEL_SERVICE_NAME;
  vi.resetModules();
});

const loadTracing = async () => import("../../../src/services/tracing.js");

describe("tracing service", () => {
  test("disabled when endpoint missing", async () => {
    process.env.PROXY_ENABLE_OTEL = "true";
    const tracing = await loadTracing();
    expect(tracing.tracingEnabled()).toBe(false);
    expect(tracing.startHttpSpan({ headers: {}, method: "GET", url: "/x" })).toBeNull();
  });

  test("startHttpSpan yields span when enabled and endpoint present", async () => {
    process.env.PROXY_ENABLE_OTEL = "true";
    process.env.PROXY_OTEL_EXPORTER_URL = "http://otel.test";
    process.env.PROXY_OTEL_SERVICE_NAME = "trace-spec";
    const tracing = await loadTracing();
    expect(tracing.tracingEnabled()).toBe(true);
    const spanInfo = tracing.startHttpSpan({
      headers: { traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" },
      method: "POST",
      route: "/v1/chat",
      originalUrl: "/v1/chat",
      url: "/v1/chat",
      ip: "127.0.0.1",
    });
    expect(spanInfo?.span).toBeDefined();
    const ctx = spanInfo.span.spanContext();
    expect(ctx.traceId).toBeTruthy();
    expect(ctx.spanId).toBeTruthy();
    tracing.endSpan(spanInfo.span, { code: 1, attributes: { foo: "bar" } });
  });
});
