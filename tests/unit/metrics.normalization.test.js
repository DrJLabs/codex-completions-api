import { beforeEach, describe, expect, it } from "vitest";
import {
  observeHttpRequest,
  recordToolBufferEvent,
  renderMetrics,
  resetMetrics,
  setMaintenanceState,
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
});
