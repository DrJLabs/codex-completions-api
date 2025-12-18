import { Counter, Gauge, Histogram, Registry, Summary, collectDefaultMetrics } from "prom-client";

const registry = new Registry();
collectDefaultMetrics({ register: registry });

const LATENCY_BUCKETS_MS = [50, 100, 200, 400, 800, 1200, 2000, 5000, 10000];
const HTTP_LABELS = ["route", "method", "status_family", "model"];
const TOOL_BUFFER_LABELS = ["output_mode", "reason"];
const STREAM_LABELS = ["route", "model", "outcome"];
const STREAM_TTFB_LABELS = ["route", "model"];
const STREAM_DURATION_BUCKETS_MS = [100, 250, 500, 1000, 2000, 5000, 15000, 60000, 180000];
const RESPONSES_SSE_EVENT_LABELS = ["route", "model", "event"];

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

const streamTtfb = new Histogram({
  name: "codex_stream_ttfb_ms",
  help: "Time to first byte for streaming responses",
  buckets: LATENCY_BUCKETS_MS,
  labelNames: STREAM_TTFB_LABELS,
  registers: [registry],
});

const streamDuration = new Histogram({
  name: "codex_stream_duration_ms",
  help: "Total stream duration by outcome",
  buckets: STREAM_DURATION_BUCKETS_MS,
  labelNames: STREAM_LABELS,
  registers: [registry],
});

const streamEnds = new Counter({
  name: "codex_stream_end_total",
  help: "Stream termination counts by outcome",
  labelNames: STREAM_LABELS,
  registers: [registry],
});

const responsesSseEvents = new Counter({
  name: "codex_responses_sse_event_total",
  help: "Typed SSE events emitted by the /v1/responses stream adapter",
  labelNames: RESPONSES_SSE_EVENT_LABELS,
  registers: [registry],
});

const workerRestarts = new Gauge({
  name: "codex_worker_restarts_total",
  help: "Codex worker restart count",
  registers: [registry],
});

const workerRestartsCounter = new Counter({
  name: "codex_worker_restarts_inc_total",
  help: "Codex worker restarts (incrementing)",
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

const toolBufferAnomaly = new Gauge({
  name: "codex_tool_buffer_anomaly",
  help: "Tool buffer anomaly signal (1 when active within the last 2m, else 0)",
  registers: [registry],
});
toolBufferAnomaly.set(0);

let toolBufferAnomalyReset;

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

const normalizeEvent = (event) => {
  const value = emptyIfWhitespace(event, "unknown");
  return value.length > 64 ? value.slice(0, 64) : value;
};

const normalizeOutcome = (outcome) => {
  if (!outcome) return "unknown";
  const normalized = String(outcome).trim().toLowerCase();
  if (!normalized) return "unknown";
  return normalized.length > 48 ? normalized.slice(0, 48) : normalized;
};

const normalizeStreamLabels = ({ route, model, outcome }) => ({
  route: normalizeRoute(route),
  model: normalizeModel(model),
  outcome: normalizeOutcome(outcome),
});

const normalizeStreamTtfbLabels = ({ route, model }) => ({
  route: normalizeRoute(route),
  model: normalizeModel(model),
});

const normalizeResponsesSseEventLabels = ({ route, model, event }) => ({
  route: normalizeRoute(route),
  model: normalizeModel(model),
  event: normalizeEvent(event),
});

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
    toolBufferAnomaly.set(1);
    if (toolBufferAnomalyReset) clearTimeout(toolBufferAnomalyReset);
    toolBufferAnomalyReset = setTimeout(() => {
      toolBufferAnomaly.set(0);
      toolBufferAnomalyReset = undefined;
    }, 120000);
  }
}

export function recordResponsesSseEvent({ route, model, event }) {
  try {
    const labels = normalizeResponsesSseEventLabels({ route, model, event });
    responsesSseEvents.inc(labels);
  } catch {
    // Metrics failures are non-critical; swallow to avoid impacting callers.
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
  const ready = (status?.health?.readiness?.ready ?? status?.ready) ? 1 : 0;
  workerReady.set(ready);
}

let lastWorkerRestartCount = 0;
export function observeWorkerRestartDelta(status) {
  const restarts = Number(status?.metrics?.codex_worker_restarts_total ?? status?.restarts_total);
  if (!Number.isFinite(restarts)) return;
  const delta = restarts - lastWorkerRestartCount;
  if (delta > 0) {
    workerRestartsCounter.inc(delta);
    lastWorkerRestartCount = restarts;
  }
}

export function createStreamObserver({ route, model }) {
  const startedAt = Date.now();
  const ttfbLabels = normalizeStreamTtfbLabels({ route, model });
  const durationLabelsBase = { route: ttfbLabels.route, model: ttfbLabels.model };
  let firstSeen = false;
  let ended = false;

  const markFirst = () => {
    if (firstSeen) return;
    firstSeen = true;
    streamTtfb.observe(ttfbLabels, Math.max(Date.now() - startedAt, 0));
  };

  const end = (outcome = "ok") => {
    if (ended) return;
    ended = true;
    const labels = normalizeStreamLabels({ ...durationLabelsBase, outcome });
    if (!firstSeen) markFirst();
    streamDuration.observe(labels, Math.max(Date.now() - startedAt, 0));
    streamEnds.inc(labels);
  };

  return { markFirst, end };
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
