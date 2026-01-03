import { describe, expect, it, vi } from "vitest";
import { createStreamRuntime } from "../../../../src/handlers/chat/stream-runtime.js";

const createOutputStub = () => ({
  emitDelta: vi.fn(),
  emitMessage: vi.fn(),
  emitUsage: vi.fn(),
  emitFinish: vi.fn(),
  emitError: vi.fn(),
});

const createToolNormalizerStub = () => ({
  ingestDelta: vi.fn((payload) => payload),
  ingestMessage: vi.fn((payload) => payload),
  finalize: vi.fn(() => null),
});

describe("stream runtime", () => {
  it("routes delta payloads into output emission", () => {
    const output = createOutputStub();
    const toolNormalizer = createToolNormalizerStub();
    const runtime = createStreamRuntime({
      output,
      toolNormalizer,
      finishTracker: { onDelta: vi.fn(), onMessage: vi.fn(), finalize: vi.fn() },
    });

    runtime.handleDelta({
      choiceIndex: 0,
      delta: { content: "hi" },
      eventType: "agent_message_delta",
    });

    expect(toolNormalizer.ingestDelta).toHaveBeenCalled();
    expect(output.emitDelta).toHaveBeenCalledWith(
      0,
      { content: "hi" },
      expect.objectContaining({ eventType: "agent_message_delta" })
    );
  });
});
