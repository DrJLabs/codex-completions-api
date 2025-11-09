import { describe, expect, test, vi } from "vitest";
import { createFinishReasonTracker } from "../../../src/handlers/chat/shared.js";

describe("finish reason tracker", () => {
  test("prioritizes token_count reasons over lower-priority sources", () => {
    const tracker = createFinishReasonTracker({ fallback: "stop" });
    tracker.record("stop", "task_complete");
    tracker.record("tool_calls", "provider");
    tracker.record("length", "token_count");

    const result = tracker.resolve();
    expect(result.reason).toBe("length");
    expect(result.source).toBe("token_count");
  });

  test("promotes finish reason to tool_calls when aggregator has tool data", () => {
    const tracker = createFinishReasonTracker({ fallback: "stop" });
    tracker.record("stop", "task_complete");

    const result = tracker.resolve({ hasToolCalls: true });
    expect(result.reason).toBe("tool_calls");
    expect(result.source).toBe("tool_presence");
  });

  test("tracks unknown reasons and notifies callback", () => {
    const onUnknown = vi.fn();
    const tracker = createFinishReasonTracker({ fallback: "stop", onUnknown });
    tracker.record("mystery_state", "provider");

    expect(onUnknown).toHaveBeenCalledWith({ source: "provider", value: "mystery_state" });
    const result = tracker.resolve();
    expect(result.reason).toBe("stop");
    expect(result.unknown).toEqual([{ source: "provider", value: "mystery_state" }]);
  });
});
