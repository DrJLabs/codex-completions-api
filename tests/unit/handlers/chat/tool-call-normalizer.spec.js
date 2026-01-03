import { describe, expect, it } from "vitest";
import { createToolCallNormalizer } from "../../../../src/handlers/chat/tool-call-normalizer.js";

describe("tool-call-normalizer", () => {
  it("normalizes legacy function_call into tool_calls", () => {
    const normalizer = createToolCallNormalizer({
      maxBlocks: 0,
      stopAfterTools: false,
      suppressTail: false,
      outputMode: "text",
    });
    const delta = { function_call: { name: "lookup", arguments: "{}" } };

    const normalized = normalizer.ingestDelta(delta);

    expect(normalized.tool_calls).toHaveLength(1);
    expect(normalized.function_call).toBeUndefined();
  });
});
