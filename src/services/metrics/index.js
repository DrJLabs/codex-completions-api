import { Counter, Gauge, Histogram, Registry, Summary, collectDefaultMetrics } from "prom-client";

const registry = new Registry();
collectDefaultMetrics({ register: registry });

const LATENCY_BUCKETS_MS = [50, 100, 200, 400, 800, 1200, 2000, 5000, 10000];
const HTTP_LABELS = ["route", "method", "status_family", "model"];
const TOOL_BUFFER_LABELS = ["output_mode", "reason"];

const httpRequestsTotal = new Counter({
  name: "codex_http_requests_total",
  help: "Total HTTP requests by route, method, status family, and model",
  labelNames: HTTP_LABELS,
  registers: [registry],
});

const httpRequestErrors = new Counter({
  name: "codex_http_errors_total",
  help: "HTTP 5xx responses by route and method",
  labelNames: HTTP_LABELS,
  registers: [registry],
});

const httpLatency = new Histogram({
  name: "codex_http_latency_ms",
  help: "HTTP request latency in milliseconds",
  buckets: LATENCY_BUCKETS_MS,
  labelNames: HTTP_LABELS,
  registers: [registry],
});

const httpLatencySummary = new Summary({
  name: "codex_http_latency_summary_ms",
  help: "HTTP request latency summary in milliseconds",
  percentiles: [0.5, 0.9, 0.95, 0.99],
  labelNames: HTTP_LABELS,
  registers: [registry],
});

const workerRestarts = new Gauge({
  name: "codex_worker_restarts_total",
  help: "Codex worker restart count",
  registers: [registry],
});

const workerBackoffMs = new Gauge({
  name: "codex_worker_backoff_ms",
  help: "Current Codex worker restart backoff (ms)",
  registers: [registry],
});

const workerReady = new Gauge({
  name: "codex_worker_ready",
  help: "Codex worker readiness (1=ready, 0=not ready)",
  registers: [registry],
});

const streamsActive = new Gauge({
  name: "codex_streams_active",
  help: "Active SSE stream count",
  registers: [registry],
});

const toolBufferStarted = new Counter({
  name: "codex_tool_buffer_started_total",
  help: "Tool buffer started events",
  labelNames: TOOL_BUFFER_LABELS,
  registers: [registry],
});

const toolBufferFlushed = new Counter({
  name: "codex_tool_buffer_flushed_total",
  help: "Tool buffer flushed events",
  labelNames: TOOL_BUFFER_LABELS,
  registers: [registry],
});

const toolBufferAborted = new Counter({
  name: "codex_tool_buffer_aborted_total",
  help: "Tool buffer aborted events",
  labelNames: TOOL_BUFFER_LABELS,
  registers: [registry],
});

const maintenanceMode = new Gauge({
  name: "codex_maintenance_mode",
  help: "Maintenance flag (1=maintenance enabled, 0=normal)",
  registers: [registry],
});

const emptyIfWhitespace = (value, fallback = "") => {
  if (value === null || value === undefined) return fallback;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : fallback;
};

const normalizeRoute = (route) => {
  const base = emptyIfWhitespace(route, "unknown");
  const noQuery = base.split("?")[0];
  return noQuery || "unknown";
};

const normalizeMethod = (method) => emptyIfWhitespace(method, "UNKNOWN").toUpperCase();

const normalizeStatusFamily = (statusCode) => {
  const code = Number(statusCode);
  if (!Number.isFinite(code) || code <= 0) return "unknown";
  const family = Math.floor(code / 100);
  return `${family}xx`;
};

const normalizeModel = (model) => {
  const value = emptyIfWhitespace(model, "unknown");
  return value.length > 64 ? value.slice(0, 64) : value;
};

const normalizeHttpLabels = ({ route, method, statusCode, model }) => ({
  route: normalizeRoute(route),
  method: normalizeMethod(method),
  status_family: normalizeStatusFamily(statusCode),
  model: normalizeModel(model),
});

export function observeHttpRequest({ route, method, statusCode, model, durationMs }) {
  const labels = normalizeHttpLabels({ route, method, statusCode, model });
  httpRequestsTotal.inc(labels);
  if (Number.isFinite(durationMs) && durationMs >= 0) {
    httpLatency.observe(labels, durationMs);
    httpLatencySummary.observe(labels, durationMs);
  }
  if (Number(statusCode) >= 500) {
    httpRequestErrors.inc(labels);
  }
}

export function recordToolBufferEvent(kind, labels = {}) {
  const safeLabels = {
    output_mode: normalizeRoute(labels.output_mode || "unknown"),
    reason: normalizeRoute(labels.reason || "unknown"),
  };
  if (kind === "start") {
    toolBufferStarted.inc(safeLabels);
  } else if (kind === "flush") {
    toolBufferFlushed.inc(safeLabels);
  } else if (kind === "abort") {
    toolBufferAborted.inc(safeLabels);
  }
}

export function setActiveStreams(value) {
  if (!Number.isFinite(value)) return;
  streamsActive.set(Math.max(0, Number(value)));
}

export function setWorkerMetrics(status) {
  const restarts = Number(status?.metrics?.codex_worker_restarts_total ?? status?.restarts_total);
  if (Number.isFinite(restarts)) workerRestarts.set(restarts);
  const backoff = Number(status?.next_restart_delay_ms ?? status?.metrics?.codex_worker_latency_ms);
  if (Number.isFinite(backoff)) workerBackoffMs.set(backoff);
  const ready = status?.ready ? 1 : 0;
  workerReady.set(ready);
}

export function setMaintenanceState(enabled) {
  maintenanceMode.set(enabled ? 1 : 0);
}

export function resetMetrics() {
  registry.resetMetrics();
}

export async function renderMetrics() {
  return registry.metrics();
}

export function getMetricsRegistry() {
  return registry;
}
