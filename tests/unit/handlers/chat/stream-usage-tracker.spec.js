import { describe, expect, it, vi } from "vitest";
import { createStreamUsageTracker } from "../../../../src/handlers/chat/stream-usage-tracker.js";

describe("stream usage tracker", () => {
  it("emits usage chunk with aggregated counts", () => {
    const sendChunk = vi.fn();
    const tracker = createStreamUsageTracker({
      includeUsage: true,
      choiceCount: 2,
      promptTokensEst: 5,
      startedAt: 1000,
      getEmittedLength: () => 8,
      getFirstTokenAt: () => 1100,
      sendChunk,
      appendUsage: vi.fn(),
      resolveFinishReason: () => ({ reason: "stop", source: "finalizer" }),
      hasToolCallEvidence: () => false,
      hasFunctionCall: false,
      toolCallAggregator: { supportsParallelCalls: () => false, hasCalls: () => false },
      getToolStats: () => ({ count: 0, truncated: 0 }),
      stopAfterToolsMode: "burst",
      outputMode: "text",
      req: { method: "POST", headers: {} },
      res: {},
      reqId: "req-1",
      route: "/v1/chat/completions",
      mode: "chat_stream",
      requestedModel: "gpt-test",
      effectiveModel: "gpt-test",
    });

    tracker.updateUsageCounts("token_count", { prompt: 5, completion: 4 });
    tracker.emitUsageChunk("token_count");

    expect(sendChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        usage: expect.objectContaining({
          prompt_tokens: 5,
          completion_tokens: 8,
          total_tokens: 13,
          emission_trigger: "token_count",
        }),
      })
    );
  });

  it("logs usage only once", () => {
    const appendUsage = vi.fn();
    const tracker = createStreamUsageTracker({
      includeUsage: false,
      choiceCount: 1,
      promptTokensEst: 2,
      startedAt: 1000,
      getEmittedLength: () => 4,
      getFirstTokenAt: () => 1100,
      sendChunk: vi.fn(),
      appendUsage,
      resolveFinishReason: () => ({ reason: "stop", source: "finalizer" }),
      hasToolCallEvidence: () => false,
      hasFunctionCall: false,
      toolCallAggregator: { supportsParallelCalls: () => false, hasCalls: () => false },
      getToolStats: () => ({ count: 0, truncated: 0 }),
      stopAfterToolsMode: "burst",
      outputMode: "text",
      req: { method: "POST", headers: {} },
      res: {},
      reqId: "req-1",
      route: "/v1/chat/completions",
      mode: "chat_stream",
      requestedModel: "gpt-test",
      effectiveModel: "gpt-test",
    });

    tracker.logUsage("token_count");
    tracker.logUsage("token_count");

    expect(appendUsage).toHaveBeenCalledTimes(1);
  });
});
