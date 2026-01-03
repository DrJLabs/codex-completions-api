import { describe, expect, it } from "vitest";
import {
  createToolCallNormalizer,
  normalizeToolCalls,
} from "../../../../src/handlers/chat/tool-call-normalizer.js";

describe("tool-call-normalizer", () => {
  it("normalizes legacy function_call into tool_calls", () => {
    const normalizer = createToolCallNormalizer();
    const delta = { function_call: { name: "lookup", arguments: "{}" } };

    const normalized = normalizer.ingestDelta(delta);

    expect(normalized.tool_calls).toHaveLength(1);
    expect(normalized.function_call).toBeUndefined();
    expect(normalized.tool_calls?.[0]?.id).toBe("tool_0_0");
  });

  it("increments legacy tool ids across multiple calls", () => {
    const normalizer = createToolCallNormalizer();
    const first = normalizer.ingestDelta({ function_call: { name: "lookup", arguments: "{}" } });
    const second = normalizer.ingestMessage({
      function_call: { name: "lookup2", arguments: "{}" },
    });

    expect(first.tool_calls?.[0]?.id).toBe("tool_0_0");
    expect(second.tool_calls?.[0]?.id).toBe("tool_0_1");
  });

  it("preserves existing tool_calls", () => {
    const payload = {
      tool_calls: [{ id: "tool_123", type: "function", function: { name: "a", arguments: "{}" } }],
    };

    const normalized = normalizeToolCalls(payload);

    expect(normalized.tool_calls?.[0]?.id).toBe("tool_123");
  });
});
