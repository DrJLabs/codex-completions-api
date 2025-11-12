import { describe, expect, test, vi } from "vitest";
import { createStopAfterToolsController } from "../../../../src/handlers/chat/stop-after-tools-controller.js";

const sumCounts = (store) => Array.from(store.values()).reduce((sum, value) => sum + value, 0);

describe("stop-after-tools controller", () => {
  test("caps are enforced per choice before triggering a cutoff", () => {
    const counts = new Map();
    const onCutoff = vi.fn();

    const controller = createStopAfterToolsController({
      enforce: true,
      stopAfterToolsMode: "burst",
      stopAfterToolsMax: 1,
      graceMs: 25,
      getTotalForwardedToolCount: () => sumCounts(counts),
      getChoiceForwardedToolCount: (choiceIndex) => counts.get(choiceIndex) || 0,
      onCutoff,
    });

    counts.set(0, 1);
    controller.schedule(0);
    expect(onCutoff).not.toHaveBeenCalled();

    counts.set(1, 1);
    controller.schedule(1);
    expect(onCutoff).not.toHaveBeenCalled();

    counts.set(0, 2);
    controller.schedule(0);
    expect(onCutoff).toHaveBeenCalledTimes(1);
  });

  test("burst mode waits for the grace window before cutting off", () => {
    vi.useFakeTimers();
    const onCutoff = vi.fn();

    const controller = createStopAfterToolsController({
      enforce: true,
      stopAfterToolsMode: "burst",
      stopAfterToolsMax: 0,
      graceMs: 50,
      getTotalForwardedToolCount: () => 1,
      getChoiceForwardedToolCount: () => 1,
      onCutoff,
    });

    controller.schedule(0);
    expect(onCutoff).not.toHaveBeenCalled();
    vi.advanceTimersByTime(49);
    expect(onCutoff).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onCutoff).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  test("first mode cuts immediately after the first tool call", () => {
    const onCutoff = vi.fn();
    const controller = createStopAfterToolsController({
      enforce: true,
      stopAfterToolsMode: "first",
      stopAfterToolsMax: 0,
      graceMs: 100,
      getTotalForwardedToolCount: () => 1,
      getChoiceForwardedToolCount: () => 1,
      onCutoff,
    });

    controller.schedule(0);
    expect(onCutoff).toHaveBeenCalledTimes(1);
  });
});
