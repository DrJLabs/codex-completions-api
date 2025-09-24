import { describe, it, expect } from "vitest";
import { createToolCallAggregator } from "../../src/lib/tool-call-aggregator.js";

describe("tool call aggregator", () => {
  it("emits deltas with stable ids and incremental arguments", () => {
    const aggregator = createToolCallAggregator({ idFactory: () => "generated_id" });

    const first = aggregator.ingestDelta({
      tool_calls: [
        {
          index: 0,
          id: "tool_1",
          type: "function",
          function: { name: "lookup_user", arguments: '{"id":"' },
        },
      ],
    });

    expect(first.deltas).toEqual([
      {
        index: 0,
        id: "tool_1",
        type: "function",
        function: { name: "lookup_user", arguments: '{"id":"' },
      },
    ]);

    const second = aggregator.ingestDelta({
      tool_calls: [
        {
          index: 0,
          function: { arguments: "42" },
        },
      ],
    });

    expect(second.deltas).toEqual([
      {
        index: 0,
        function: { arguments: "42" },
      },
    ]);

    const closingChunk = '"}';
    aggregator.ingestDelta({
      tool_calls: [
        {
          index: 0,
          function: { arguments: closingChunk },
        },
      ],
    });

    const snapshot = aggregator.snapshot();
    expect(snapshot).toEqual([
      {
        id: "tool_1",
        type: "function",
        function: { name: "lookup_user", arguments: '{"id":"42"}' },
      },
    ]);
  });

  it("falls back to generated id when upstream omits it", () => {
    const aggregator = createToolCallAggregator({ idFactory: () => "gen_0" });
    const { deltas } = aggregator.ingestDelta({
      tool_calls: [
        {
          index: 0,
          function: { name: "lookup_user", arguments: "{}" },
        },
      ],
    });

    expect(deltas[0].id).toBe("gen_0");
    const snapshot = aggregator.snapshot();
    expect(snapshot[0].id).toBe("gen_0");
  });

  it("emits fallback delta when only final message contains tool calls", () => {
    const aggregator = createToolCallAggregator({ idFactory: () => "gen_fallback" });
    const { deltas } = aggregator.ingestMessage(
      {
        tool_calls: [
          {
            type: "function",
            function: { name: "lookup_user", arguments: '{"id":"86"}' },
          },
        ],
      },
      { emitIfMissing: true }
    );

    expect(deltas).toEqual([
      {
        index: 0,
        id: "gen_fallback",
        type: "function",
        function: { name: "lookup_user", arguments: '{"id":"86"}' },
      },
    ]);
  });

  it("reports parallel tool call support flag", () => {
    const aggregator = createToolCallAggregator();
    aggregator.ingestDelta({
      tool_calls: [{ index: 0, function: { name: "lookup_user" } }],
    });
    expect(aggregator.supportsParallelCalls()).toBe(true);
    aggregator.ingestMessage({ parallel_tool_calls: false, tool_calls: [] });
    expect(aggregator.supportsParallelCalls()).toBe(false);
  });
});
