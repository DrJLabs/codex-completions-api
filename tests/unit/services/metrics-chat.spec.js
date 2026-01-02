import { beforeEach, describe, expect, it, vi } from "vitest";

const recordToolBufferEventMock = vi.fn();

vi.mock("../../../src/services/metrics/index.js", () => ({
  recordToolBufferEvent: (...args) => recordToolBufferEventMock(...args),
}));

import toolBufferMetrics from "../../../src/services/metrics/chat.js";

describe("toolBufferMetrics", () => {
  beforeEach(() => {
    toolBufferMetrics.reset();
    recordToolBufferEventMock.mockReset();
  });

  it("tracks totals and normalizes labels", () => {
    toolBufferMetrics.start({ output_mode: "text", reason: "ok" });
    toolBufferMetrics.start({ reason: "ok", output_mode: "text" });
    toolBufferMetrics.flush({ output_mode: "text", reason: "ok" });
    toolBufferMetrics.abort({ output_mode: "chat", reason: undefined, "": "skip" });

    const summary = toolBufferMetrics.summary();

    expect(summary.started.total).toBe(2);
    expect(summary.started.buckets).toEqual([
      { labels: { output_mode: "text", reason: "ok" }, value: 2 },
    ]);
    expect(summary.flushed.total).toBe(1);
    expect(summary.flushed.buckets).toEqual([
      { labels: { output_mode: "text", reason: "ok" }, value: 1 },
    ]);
    expect(summary.aborted.total).toBe(1);
    expect(summary.aborted.buckets).toEqual([
      { labels: { output_mode: "chat", reason: "" }, value: 1 },
    ]);

    expect(recordToolBufferEventMock).toHaveBeenCalledWith("start", {
      output_mode: "text",
      reason: "ok",
    });
  });

  it("swallows recordToolBufferEvent failures", () => {
    recordToolBufferEventMock.mockImplementation(() => {
      throw new Error("boom");
    });

    expect(() => toolBufferMetrics.start({ output_mode: "text" })).not.toThrow();
    expect(() => toolBufferMetrics.flush({ output_mode: "text" })).not.toThrow();
    expect(() => toolBufferMetrics.abort({ output_mode: "text" })).not.toThrow();

    const summary = toolBufferMetrics.summary();
    expect(summary.started.total).toBe(1);
    expect(summary.flushed.total).toBe(1);
    expect(summary.aborted.total).toBe(1);
  });

  it("reset clears counters", () => {
    toolBufferMetrics.start({ output_mode: "text" });
    toolBufferMetrics.flush({ output_mode: "text" });

    toolBufferMetrics.reset();

    const summary = toolBufferMetrics.summary();
    expect(summary.started.total).toBe(0);
    expect(summary.flushed.total).toBe(0);
    expect(summary.aborted.total).toBe(0);
    expect(summary.started.buckets).toEqual([]);
    expect(summary.flushed.buckets).toEqual([]);
    expect(summary.aborted.buckets).toEqual([]);
  });
});
