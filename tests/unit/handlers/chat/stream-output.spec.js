import { describe, expect, it, vi } from "vitest";
import { createStreamOutputCoordinator } from "../../../../src/handlers/chat/stream-output.js";

describe("stream output coordinator", () => {
  it("emits text delta in text mode", () => {
    const state = {
      emitted: "",
      forwardedUpTo: 0,
      scanPos: 0,
      lastToolEnd: -1,
      textualToolContentSeen: false,
      dropAssistantContentAfterTools: false,
      sentAny: false,
      hasToolEvidence: false,
      structuredCount: 0,
      forwardedToolCount: 0,
      toolBuffer: { active: false },
    };

    const sendChoiceDelta = vi.fn();
    const coordinator = createStreamOutputCoordinator({
      isObsidianOutput: false,
      outputMode: "text",
      stopAfterTools: false,
      suppressTailAfterTools: false,
      toolCallAggregator: { snapshot: () => [] },
      toolBufferMetrics: { start: vi.fn(), flush: vi.fn(), abort: vi.fn() },
      ensureChoiceState: () => state,
      sendChoiceDelta,
      emitTextualToolMetadata: vi.fn(() => false),
      scheduleStopAfterTools: vi.fn(),
      extractUseToolBlocks: () => ({ blocks: [], nextPos: 0 }),
      trackToolBufferOpen: () => -1,
      detectNestedToolBuffer: () => -1,
      clampEmittableIndex: (_buffer, _forwarded, end) => end,
      completeToolBuffer: vi.fn(),
      abortToolBuffer: () => ({ literal: "" }),
      shouldSkipBlock: () => false,
      trimTrailingTextAfterToolBlocks: (text) => text,
      buildObsidianXmlRecord: () => null,
      logToolBufferWarning: vi.fn(),
    });

    coordinator.appendContentSegment("hello", { choiceIndex: 0 });

    expect(sendChoiceDelta).toHaveBeenCalledWith(0, { content: "hello" });
    expect(state.emitted).toBe("hello");
    expect(state.sentAny).toBe(true);
  });

  it("logs extraction failures when parsing textual tool blocks", () => {
    const state = {
      emitted: "",
      forwardedUpTo: 0,
      scanPos: 0,
      lastToolEnd: -1,
      textualToolContentSeen: false,
      dropAssistantContentAfterTools: false,
      sentAny: false,
      hasToolEvidence: false,
      structuredCount: 0,
      forwardedToolCount: 0,
      toolBuffer: { active: false },
    };

    const logToolBufferWarning = vi.fn();
    const coordinator = createStreamOutputCoordinator({
      isObsidianOutput: true,
      outputMode: "obsidian",
      stopAfterTools: false,
      suppressTailAfterTools: false,
      toolCallAggregator: { snapshot: () => [] },
      toolBufferMetrics: { start: vi.fn(), flush: vi.fn(), abort: vi.fn() },
      ensureChoiceState: () => state,
      sendChoiceDelta: vi.fn(),
      emitTextualToolMetadata: vi.fn(() => false),
      scheduleStopAfterTools: vi.fn(),
      extractUseToolBlocks: () => {
        throw new Error("boom");
      },
      trackToolBufferOpen: () => -1,
      detectNestedToolBuffer: () => -1,
      clampEmittableIndex: (_buffer, _forwarded, end) => end,
      completeToolBuffer: vi.fn(),
      abortToolBuffer: () => ({ literal: "" }),
      shouldSkipBlock: () => false,
      trimTrailingTextAfterToolBlocks: (text) => text,
      buildObsidianXmlRecord: () => null,
      logToolBufferWarning,
    });

    coordinator.appendContentSegment("hello", { choiceIndex: 0 });

    expect(logToolBufferWarning).toHaveBeenCalledWith(
      "textual_extraction_failed",
      expect.objectContaining({ choice_index: 0, error: "boom" })
    );
  });

  it("logs extraction failures when rechecking buffered tail segments", () => {
    const state = {
      emitted: "",
      forwardedUpTo: 0,
      scanPos: 0,
      lastToolEnd: -1,
      textualToolContentSeen: true,
      dropAssistantContentAfterTools: false,
      sentAny: false,
      hasToolEvidence: false,
      structuredCount: 0,
      forwardedToolCount: 0,
      toolBuffer: { active: false },
    };

    const logToolBufferWarning = vi.fn();
    const extractUseToolBlocks = vi
      .fn()
      .mockReturnValueOnce({ blocks: [], nextPos: 0 })
      .mockImplementationOnce(() => {
        throw new Error("boom");
      });

    const coordinator = createStreamOutputCoordinator({
      isObsidianOutput: true,
      outputMode: "obsidian",
      stopAfterTools: true,
      suppressTailAfterTools: false,
      toolCallAggregator: { snapshot: () => [] },
      toolBufferMetrics: { start: vi.fn(), flush: vi.fn(), abort: vi.fn() },
      ensureChoiceState: () => state,
      sendChoiceDelta: vi.fn(),
      emitTextualToolMetadata: vi.fn(() => false),
      scheduleStopAfterTools: vi.fn(),
      extractUseToolBlocks,
      trackToolBufferOpen: () => -1,
      detectNestedToolBuffer: () => -1,
      clampEmittableIndex: (_buffer, _forwarded, end) => end,
      completeToolBuffer: vi.fn(),
      abortToolBuffer: () => ({ literal: "" }),
      shouldSkipBlock: () => false,
      trimTrailingTextAfterToolBlocks: (text) => text,
      buildObsidianXmlRecord: () => null,
      logToolBufferWarning,
    });

    coordinator.appendContentSegment("hello", { choiceIndex: 0 });

    expect(logToolBufferWarning).toHaveBeenCalledWith(
      "textual_extraction_failed",
      expect.objectContaining({ choice_index: 0, error: "boom", phase: "segment" })
    );
  });

  it("logs aggregator emission failures", () => {
    const state = {
      emitted: "",
      forwardedUpTo: 0,
      scanPos: 0,
      lastToolEnd: -1,
      textualToolContentSeen: false,
      dropAssistantContentAfterTools: false,
      sentAny: false,
      hasToolEvidence: false,
      structuredCount: 0,
      forwardedToolCount: 0,
      toolBuffer: { active: false },
    };

    const logToolBufferWarning = vi.fn();
    const coordinator = createStreamOutputCoordinator({
      isObsidianOutput: true,
      outputMode: "obsidian",
      stopAfterTools: false,
      suppressTailAfterTools: false,
      toolCallAggregator: { snapshot: () => [{ id: "tool_1", function: { arguments: "{}" } }] },
      toolBufferMetrics: { start: vi.fn(), flush: vi.fn(), abort: vi.fn() },
      ensureChoiceState: () => state,
      sendChoiceDelta: vi.fn(),
      emitTextualToolMetadata: vi.fn(() => false),
      scheduleStopAfterTools: vi.fn(),
      extractUseToolBlocks: () => ({ blocks: [], nextPos: 0 }),
      trackToolBufferOpen: () => -1,
      detectNestedToolBuffer: () => -1,
      clampEmittableIndex: (_buffer, _forwarded, end) => end,
      completeToolBuffer: vi.fn(),
      abortToolBuffer: () => ({ literal: "" }),
      shouldSkipBlock: () => false,
      trimTrailingTextAfterToolBlocks: (text) => text,
      buildObsidianXmlRecord: () => {
        throw new Error("boom");
      },
      logToolBufferWarning,
    });

    const emitted = coordinator.emitAggregatorToolContent(0);

    expect(emitted).toBe(false);
    expect(logToolBufferWarning).toHaveBeenCalledWith(
      "aggregator_tool_emit_failed",
      expect.objectContaining({ choice_index: 0, error: "boom" })
    );
  });
});
