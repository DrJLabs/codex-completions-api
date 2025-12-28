import {
  context,
  diag,
  DiagConsoleLogger,
  DiagLogLevel,
  propagation,
  trace,
} from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { BasicTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { Resource } from "@opentelemetry/resources";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

const bool = (value, def = false) => {
  if (value === undefined || value === null) return def;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
};

const serviceName = process.env.PROXY_OTEL_SERVICE_NAME || "codex-app-server-proxy";
const otelEnabled = bool(process.env.PROXY_ENABLE_OTEL || process.env.OTEL_ENABLED, false);
const otelEndpoint = process.env.PROXY_OTEL_EXPORTER_URL || process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

let tracer = null;
let provider;

function initTracer() {
  if (tracer !== null) return tracer;
  if (!otelEnabled || !otelEndpoint) {
    tracer = undefined;
    return tracer;
  }
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);
  provider = new BasicTracerProvider({
    resource: new Resource({
      "service.name": serviceName,
    }),
  });
  const exporter = new OTLPTraceExporter({ url: otelEndpoint });
  provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
  provider.register();
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  tracer = trace.getTracer(serviceName);
  return tracer;
}

export function tracingEnabled() {
  return Boolean(initTracer());
}

export function startHttpSpan(req) {
  const t = initTracer();
  if (!t) return null;
  const ctx = propagation.extract(context.active(), req.headers || {});
  const route = (req.route && req.route.path) || req.originalUrl || req.url || "unknown";
  const span = t.startSpan(
    "http.server",
    {
      attributes: {
        "http.method": req.method,
        "http.route": route,
        "http.target": req.originalUrl || req.url,
        "net.peer.ip": req.ip || req.connection?.remoteAddress || "",
      },
    },
    ctx
  );
  return { span, context: trace.setSpan(ctx, span) };
}

export function startSpan(name, attributes = {}) {
  const t = initTracer();
  if (!t) return null;
  return t.startSpan(name, { attributes }, context.active());
}

export function endSpan(span, status) {
  if (!span) return;
  try {
    if (status && typeof status === "object") {
      if (status.code) span.setStatus(status);
      if (status.attributes) span.setAttributes(status.attributes);
    }
    span.end();
  } catch {}
}
