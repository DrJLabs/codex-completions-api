import { describe, it, expect } from "vitest";
import {
  createToolCallAggregator,
  extractUseToolBlocks,
  registerTextPattern,
} from "../../src/lib/tool-call-aggregator.js";

const deterministicIdFactory = ({ choiceIndex, ordinal }) => `tool_${choiceIndex}_${ordinal}`;

describe("ToolCallAggregator", () => {
  it("emits name-first deltas with cumulative arguments", () => {
    const aggregator = createToolCallAggregator({ idFactory: deterministicIdFactory });
    const first = aggregator.ingestDelta({
      tool_calls: [
        {
          index: 0,
          function: { name: "lookup_user", arguments: '{"id": "' },
        },
      ],
    });
    expect(first.updated).toBe(true);
    expect(first.deltas[0]).toEqual({
      index: 0,
      id: "tool_0_0",
      type: "function",
      function: { name: "lookup_user", arguments: '{"id": "' },
    });

    const second = aggregator.ingestDelta({
      tool_calls: [
        {
          index: 0,
          function: { arguments: "42" },
        },
      ],
    });
    expect(second.deltas[0].function.arguments).toBe('{"id": "42');

    const closing = aggregator.ingestDelta({
      tool_calls: [
        {
          index: 0,
          function: { arguments: '"}' },
        },
      ],
    });
    expect(closing.deltas[0].function.arguments).toBe('{"id": "42"}');

    const snapshot = aggregator.snapshot();
    expect(snapshot).toEqual([
      {
        id: "tool_0_0",
        type: "function",
        function: { name: "lookup_user", arguments: '{"id": "42"}' },
      },
    ]);
  });

  it("avoids emitting deltas when ingesting identical payload twice", () => {
    const aggregator = createToolCallAggregator({ idFactory: deterministicIdFactory });
    const payload = {
      tool_calls: [
        {
          index: 0,
          function: { name: "getCurrentTime", arguments: "{}" },
        },
      ],
    };
    const first = aggregator.ingestDelta(payload);
    expect(first.updated).toBe(true);
    const second = aggregator.ingestDelta(payload);
    expect(second.updated).toBe(false);
    expect(second.deltas).toEqual([]);
  });

  it("preserves multi-call ordering per snapshot", () => {
    const aggregator = createToolCallAggregator({ idFactory: deterministicIdFactory });
    aggregator.ingestDelta({
      tool_calls: [
        {
          index: 1,
          function: { name: "second", arguments: "{}" },
        },
      ],
    });
    aggregator.ingestDelta({
      tool_calls: [
        {
          index: 0,
          function: { name: "first", arguments: "{}" },
        },
      ],
    });
    const snapshot = aggregator.snapshot();
    expect(snapshot.map((entry) => entry.function.name)).toEqual(["second", "first"]);
  });

  it("isolates state per choice index", () => {
    const aggregator = createToolCallAggregator({ idFactory: deterministicIdFactory });
    aggregator.ingestDelta(
      {
        tool_calls: [
          {
            index: 0,
            function: { name: "choice1", arguments: "{}" },
          },
        ],
      },
      { choiceIndex: 1 }
    );
    expect(aggregator.snapshot()).toEqual([]);
    expect(aggregator.snapshot({ choiceIndex: 1 })).toHaveLength(1);
    aggregator.resetTurn(1);
    expect(aggregator.hasCalls({ choiceIndex: 1 })).toBe(false);
  });

  it("synthesizes textual tool blocks when emitIfMissing enabled", () => {
    const aggregator = createToolCallAggregator({ idFactory: deterministicIdFactory });
    const textBlock =
      "<use_tool>\n" +
      "<name>localSearch</name>\n" +
      "<query>vitest docs</query>\n" +
      "<salientTerms>[\"vitest\", \"docs\"]</salientTerms>\n" +
      "</use_tool>";
    const result = aggregator.ingestMessage(
      { message: { content: textBlock } },
      { emitIfMissing: true }
    );
    expect(result.updated).toBe(true);
    expect(result.deltas[0].function.name).toBe("localSearch");
    expect(result.deltas[0].function.arguments).toContain('"query": "vitest docs"');
    expect(aggregator.snapshot()).toHaveLength(1);
  });

  it("synthesizes multiple textual blocks and ignores duplicates", () => {
    const aggregator = createToolCallAggregator({ idFactory: deterministicIdFactory });
    const payload =
      '<use_tool><name>first</name><args>{"x":1}</args></use_tool>' +
      "noise" +
      '<use_tool name="second"><args>{"y":2}</args></use_tool>';
    const first = aggregator.ingestMessage({ message: { content: payload } }, { emitIfMissing: true });
    expect(first.updated).toBe(true);
    expect(first.deltas.map((delta) => delta.function.name)).toEqual(["first", "second"]);

    const repeat = aggregator.ingestMessage(
      { message: { content: payload } },
      { emitIfMissing: true }
    );
    expect(repeat.updated).toBe(false);
    expect(aggregator.snapshot()).toHaveLength(2);
  });

  it("respects custom text pattern registrations", () => {
    const unregister = registerTextPattern("tripleBracket", (text = "") => {
      const start = text.indexOf("<<<");
      const end = text.indexOf(">>>", start + 3);
      if (start < 0 || end < 0) return { blocks: [], nextPos: 0 };
      const body = text.slice(start + 3, end).trim();
      const [name, json] = body.split("::");
      return {
        blocks: [
          {
            name: name || "customTool",
            argsText: json || "{}",
            indexStart: start,
            indexEnd: end + 3,
          },
        ],
        nextPos: end + 3,
      };
    });

    const aggregator = createToolCallAggregator({ idFactory: deterministicIdFactory });
    const result = aggregator.ingestMessage(
      { message: { content: '<<<someTool::{"value": 3}>>>' } },
      { emitIfMissing: true }
    );
    expect(result.updated).toBe(true);
    expect(result.deltas[0].function.name).toBe("someTool");
    expect(result.deltas[0].function.arguments).toContain("\"value\": 3");
    unregister();
  });

  it("merges extractUseToolBlocks results across registered matchers", () => {
    const unregister = registerTextPattern("tripleBlock", (text = "", startAt = 0) => {
      const start = text.indexOf("[[[", startAt);
      const end = text.indexOf("]]]", start + 3);
      if (start < 0 || end < 0) return { blocks: [], nextPos: startAt };
      return {
        blocks: [
          {
            name: "tripleBlock",
            argsText: '{"custom":true}',
            indexStart: start,
            indexEnd: end + 3,
          },
        ],
        nextPos: end + 3,
      };
    });

    const sample =
      '<use_tool><name>localSearch</name><args>{"query":"docs"}</args></use_tool>' +
      "[[[extra]]]";
    const { blocks, nextPos } = extractUseToolBlocks(sample, 0);
    expect(blocks.map((block) => block.name)).toEqual(["localSearch", "tripleBlock"]);
    expect(nextPos).toBe(sample.length);
    unregister();
  });

  it("builds snapshots from non-stream messages with malformed or missing args", () => {
    const aggregator = createToolCallAggregator({ idFactory: deterministicIdFactory });
    aggregator.ingestMessage({
      message: {
        tool_calls: [
          { id: "call_a", index: 0, function: { name: "alpha", arguments: '{"foo":' } },
          { id: "call_b", index: 1, function: { name: "beta" } },
        ],
        function_call: { name: "legacy", arguments: '{"bar":1}' },
      },
    });
    aggregator.ingestMessage({
      message: {
        tool_calls: [{ id: "call_a", index: 0, function: { arguments: '{"foo":"bar"}' } }],
      },
    });

    const snapshot = aggregator.snapshot();
    expect(snapshot).toHaveLength(3);
    expect(snapshot.map((entry) => entry.function.name)).toEqual(["alpha", "beta", "legacy"]);
    expect(snapshot[0].function.arguments).toBe('{"foo":"bar"}');
    expect(snapshot[1].function.arguments).toBe("");
    expect(snapshot[2].function.arguments).toBe('{"bar":1}');
  });

  it("handles mixed Codex and OpenAI payloads without cross-call interleaving", () => {
    const aggregator = createToolCallAggregator({ idFactory: deterministicIdFactory });
    const start = aggregator.ingestDelta({
      type: "response.output_item.added",
      item: { id: "codex-call", type: "function_call", name: "codexSearch" },
    });
    expect(start.updated).toBe(true);
    expect(start.deltas[0].function.name).toBe("codexSearch");

    aggregator.ingestDelta({
      type: "response.function_call_arguments.delta",
      item_id: "codex-call",
      delta: '{"term":',
    });
    aggregator.ingestDelta({
      type: "response.function_call_arguments.delta",
      item_id: "codex-call",
      delta: '"docs"}',
    });

    const openai = aggregator.ingestDelta({
      tool_calls: [
        {
          index: 0,
          id: "oa-1",
          function: { name: "openaiSearch", arguments: '{"query":"test"}' },
        },
      ],
    });
    expect(openai.deltas[0].function.name).toBe("openaiSearch");

    const duplicate = aggregator.ingestDelta({
      tool_calls: [
        {
          index: 0,
          id: "oa-1",
          function: { arguments: '{"query":"test"}' },
        },
      ],
    });
    expect(duplicate.updated).toBe(false);

    const snapshot = aggregator.snapshot();
    expect(snapshot).toHaveLength(2);
    expect(snapshot[0].function).toEqual({ name: "codexSearch", arguments: '{"term":"docs"}' });
    expect(snapshot[1].function).toEqual({ name: "openaiSearch", arguments: '{"query":"test"}' });
  });

  it("tracks parallel tool-call support flag", () => {
    const aggregator = createToolCallAggregator();
    aggregator.ingestDelta({
      parallel_tool_calls: false,
      tool_calls: [
        {
          index: 0,
          function: { name: "single", arguments: "{}" },
        },
      ],
    });
    expect(aggregator.supportsParallelCalls()).toBe(false);
  });

  it("returns immutable snapshots", () => {
    const aggregator = createToolCallAggregator({ idFactory: deterministicIdFactory });
    aggregator.ingestDelta({
      tool_calls: [
        {
          index: 0,
          function: { name: "immutable", arguments: "{}" },
        },
      ],
    });
    const snap = aggregator.snapshot();
    snap[0].function.arguments = "corrupted";
    const fresh = aggregator.snapshot();
    expect(fresh[0].function.arguments).toBe("{}");
  });
});
