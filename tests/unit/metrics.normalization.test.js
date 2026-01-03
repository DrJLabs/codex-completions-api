import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createStreamObserver,
  observeHttpRequest,
  observeWorkerRestartDelta,
  recordToolBufferEvent,
  recordResponsesSseEvent,
  renderMetrics,
  resetMetrics,
  setActiveStreams,
  setMaintenanceState,
  setWorkerMetrics,
} from "../../src/services/metrics/index.js";

describe("metrics normalization", () => {
  beforeEach(() => {
    resetMetrics();
  });

  it("records HTTP metrics with normalized labels", async () => {
    observeHttpRequest({
      route: "/v1/chat/completions?foo=bar",
      method: "post",
      statusCode: 200,
      model: "codev-5",
      durationMs: 123,
    });
    const text = await renderMetrics();
    expect(text).toMatch(/codex_http_requests_total\{[^}]*route="\/v1\/chat\/completions"/);
    expect(text).toMatch(/method="POST"/);
    expect(text).toMatch(/status_family="2xx"/);
    expect(text).toMatch(/model="codev-5"/);
    expect(text).toMatch(/codex_http_latency_ms_bucket\{[^}]*le="100"/);
  });

  it("increments error counter for 5xx responses", async () => {
    observeHttpRequest({
      route: "/fail",
      method: "GET",
      statusCode: 503,
      model: "",
      durationMs: 5,
    });
    const text = await renderMetrics();
    expect(text).toMatch(/codex_http_errors_total\{[^}]*status_family="5xx"[^}]*\} 1/);
  });

  it("tracks tool buffer counters with bounded labels", async () => {
    recordToolBufferEvent("start", { output_mode: "obsidian-xml", reason: "nested_open" });
    const text = await renderMetrics();
    expect(text).toMatch(
      /codex_tool_buffer_started_total\{[^}]*output_mode="obsidian-xml"[^}]*reason="nested_open"[^}]*\} 1/
    );
  });

  it("reflects maintenance state as gauge", async () => {
    setMaintenanceState(true);
    const text = await renderMetrics();
    const maintenanceLine = text
      .split("\n")
      .find((line) => line.trim().startsWith("codex_maintenance_mode"));
    expect(maintenanceLine).toBeTruthy();
    expect(maintenanceLine.trim().endsWith(" 1")).toBe(true);
  });

  it("tracks tool buffer anomaly resets after timeout", async () => {
    vi.useFakeTimers();
    recordToolBufferEvent("abort", { output_mode: "obsidian-xml", reason: "oops" });

    let text = await renderMetrics();
    let anomalyLine = text
      .split("\n")
      .find((line) => line.trim().startsWith("codex_tool_buffer_anomaly"));
    expect(anomalyLine.trim().endsWith(" 1")).toBe(true);

    vi.advanceTimersByTime(120000);
    text = await renderMetrics();
    anomalyLine = text
      .split("\n")
      .find((line) => line.trim().startsWith("codex_tool_buffer_anomaly"));
    expect(anomalyLine.trim().endsWith(" 0")).toBe(true);

    vi.useRealTimers();
  });

  it("records typed SSE events with normalized labels", async () => {
    recordResponsesSseEvent({ route: "/v1/responses?x=1", model: "codev", event: "delta" });

    const text = await renderMetrics();
    expect(text).toMatch(/codex_responses_sse_event_total\{[^}]*route="\/v1\/responses"/);
    expect(text).toMatch(/event="delta"/);
    expect(text).toMatch(/model="codev"/);
  });

  it("clamps active stream gauges and ignores invalid values", async () => {
    setActiveStreams(3);
    setActiveStreams(Number.NaN);
    setActiveStreams(-2);

    const text = await renderMetrics();
    const activeLine = text
      .split("\n")
      .find((line) => line.trim().startsWith("codex_streams_active"));
    expect(activeLine.trim().endsWith(" 0")).toBe(true);
  });

  it("updates worker metrics from status payloads", async () => {
    setWorkerMetrics({
      metrics: { codex_worker_restarts_total: 2 },
      next_restart_delay_ms: 1234,
      health: { readiness: { ready: false } },
    });

    const text = await renderMetrics();
    expect(text).toMatch(/codex_worker_restarts_total 2/);
    expect(text).toMatch(/codex_worker_backoff_ms 1234/);
    expect(text).toMatch(/codex_worker_ready 0/);
  });

  it("increments worker restart deltas", async () => {
    observeWorkerRestartDelta({ restarts_total: 2 });
    observeWorkerRestartDelta({ restarts_total: 3 });

    const text = await renderMetrics();
    expect(text).toMatch(/codex_worker_restarts_inc_total 3/);
  });

  it("records stream observer timings and outcomes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    const observer = createStreamObserver({ route: "/v1/responses?x=1", model: "test" });

    vi.advanceTimersByTime(250);
    observer.end("error");

    const text = await renderMetrics();
    expect(text).toMatch(/codex_stream_end_total\{[^}]*outcome="error"/);
    expect(text).toMatch(/codex_stream_ttfb_ms_count\{[^}]*route="\/v1\/responses"/);

    vi.useRealTimers();
  });
});
