import { describe, expect, it, vi } from "vitest";
import { createStreamEventRouter } from "../../../../src/handlers/chat/stream-event-router.js";

describe("stream event router", () => {
  it("routes message events to transport", () => {
    const handleParsedEvent = vi.fn(() => true);
    const router = createStreamEventRouter({
      parseStreamEventLine: () => ({
        type: "agent_message_delta",
        payload: {},
        params: {},
        messagePayload: { delta: "hi" },
      }),
      sanitizeMetadata: false,
      handleParsedEvent,
      trackToolSignals: vi.fn(),
      extractFinishReasonFromMessage: vi.fn(),
      trackFinishReason: vi.fn(),
      updateUsageCounts: vi.fn(),
      mergeMetadataInfo: vi.fn(),
      recordSanitizedMetadata: vi.fn(),
      shouldDropFunctionCallOutput: vi.fn(),
      getUsageTrigger: () => null,
      markUsageTriggerIfMissing: vi.fn(),
      hasAnyChoiceSent: () => true,
      hasLengthEvidence: () => false,
      emitFinishChunk: vi.fn(),
      finalizeStream: vi.fn(),
    });

    router.handleLine('{"type":"agent_message_delta"}');

    expect(handleParsedEvent).toHaveBeenCalled();
  });

  it("finalizes on task_complete", () => {
    const finalizeStream = vi.fn();
    const emitFinishChunk = vi.fn();
    const updateUsageCounts = vi.fn();
    const router = createStreamEventRouter({
      parseStreamEventLine: () => ({
        type: "task_complete",
        payload: {},
        params: {},
        messagePayload: { completion_tokens: 3 },
      }),
      sanitizeMetadata: false,
      handleParsedEvent: vi.fn(),
      trackToolSignals: vi.fn(),
      extractFinishReasonFromMessage: () => "stop",
      trackFinishReason: vi.fn(),
      updateUsageCounts,
      mergeMetadataInfo: vi.fn(),
      recordSanitizedMetadata: vi.fn(),
      shouldDropFunctionCallOutput: vi.fn(),
      getUsageTrigger: () => null,
      markUsageTriggerIfMissing: vi.fn(),
      hasAnyChoiceSent: () => true,
      hasLengthEvidence: () => false,
      emitFinishChunk,
      finalizeStream,
    });

    const result = router.handleLine('{"type":"task_complete"}');
    expect(emitFinishChunk).toHaveBeenCalledWith("stop");
    expect(finalizeStream).toHaveBeenCalledWith({
      reason: "stop",
      trigger: "task_complete",
    });
    expect(result.stop).toBe(true);
  });
});
