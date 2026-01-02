import { describe, it, expect, vi } from "vitest";
import {
  createToolCallAggregator,
  extractUseToolBlocks,
  registerTextPattern,
} from "../../src/lib/tool-call-aggregator.js";

const deterministicIdFactory = ({ choiceIndex, ordinal }) => `tool_${choiceIndex}_${ordinal}`;

describe("ToolCallAggregator", () => {
  it("ignores invalid text pattern registrations", () => {
    const noop = registerTextPattern(" ", null as unknown as () => void);
    expect(typeof noop).toBe("function");
    noop();
  });

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
      '<salientTerms>["vitest", "docs"]</salientTerms>\n' +
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
    const first = aggregator.ingestMessage(
      { message: { content: payload } },
      { emitIfMissing: true }
    );
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
    expect(result.deltas[0].function.arguments).toContain('"value": 3');
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
      '<use_tool><name>localSearch</name><args>{"query":"docs"}</args></use_tool>' + "[[[extra]]]";
    const { blocks, nextPos } = extractUseToolBlocks(sample, 0);
    expect(blocks.map((block) => block.name)).toEqual(["localSearch", "tripleBlock"]);
    expect(nextPos).toBe(sample.length);
    unregister();
  });

  it("warns when a custom matcher throws", () => {
    const warnSpy =
      typeof process.emitWarning === "function"
        ? vi.spyOn(process, "emitWarning").mockImplementation(() => {})
        : vi.spyOn(console, "warn").mockImplementation(() => {});
    const unregister = registerTextPattern("badMatcher", () => {
      throw new Error("boom");
    });

    const result = extractUseToolBlocks("<use_tool><name>x</name></use_tool>", 0);
    expect(result.blocks.length).toBeGreaterThan(0);
    expect(warnSpy).toHaveBeenCalled();

    unregister();
    warnSpy.mockRestore();
  });

  it("dedupes warnings for repeated matcher failures", () => {
    const warnSpy =
      typeof process.emitWarning === "function"
        ? vi.spyOn(process, "emitWarning").mockImplementation(() => {})
        : vi.spyOn(console, "warn").mockImplementation(() => {});
    const unregister = registerTextPattern("repeatBoom", () => {
      throw new Error("boom");
    });

    extractUseToolBlocks("<use_tool><name>x</name></use_tool>", 0);
    extractUseToolBlocks("<use_tool><name>x</name></use_tool>", 0);

    expect(warnSpy).toHaveBeenCalledTimes(1);

    unregister();
    warnSpy.mockRestore();
  });

  it("handles malformed JSON inside use_tool blocks", () => {
    const warnSpy =
      typeof process.emitWarning === "function"
        ? vi.spyOn(process, "emitWarning").mockImplementation(() => {})
        : vi.spyOn(console, "warn").mockImplementation(() => {});
    const aggregator = createToolCallAggregator({ idFactory: deterministicIdFactory });
    const payload = "<use_tool>{not-json}</use_tool>";
    const result = aggregator.ingestMessage(
      { message: { content: payload } },
      { emitIfMissing: true }
    );

    expect(result.updated).toBe(true);
    expect(result.deltas[0].function.name).toBe("use_tool");
    expect(result.deltas[0].function.arguments ?? "").toBe("");
    expect(aggregator.snapshot()[0].function.arguments).toBe("");

    warnSpy.mockRestore();
  });

  it("parses JSON payloads in use_tool blocks", () => {
    const aggregator = createToolCallAggregator({ idFactory: deterministicIdFactory });
    const payload = '<use_tool>{"name":"jsonTool","path":"/tmp","query":"docs"}</use_tool>';

    const result = aggregator.ingestMessage(
      { message: { content: payload } },
      { emitIfMissing: true }
    );

    expect(result.updated).toBe(true);
    expect(result.deltas[0].function.name).toBe("jsonTool");
    expect(result.deltas[0].function.arguments).toContain('"path":"/tmp"');
  });

  it("skips incomplete use_tool blocks without closing tags", () => {
    const { blocks } = extractUseToolBlocks("<use_tool><name>x</name>", 0);
    expect(blocks).toEqual([]);
  });

  it("falls back to the default matcher when registry is cleared", async () => {
    vi.resetModules();
    const mod = await import("../../src/lib/tool-call-aggregator.js");
    const unregister = mod.registerTextPattern("use_tool", () => ({
      blocks: [],
      nextPos: 0,
    }));
    unregister();

    const { blocks } = mod.extractUseToolBlocks("<use_tool><name>x</name></use_tool>", 0);
    expect(blocks.length).toBeGreaterThan(0);
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

  it("preserves UTF-8 multi-byte arguments across incremental chunks", () => {
    const aggregator = createToolCallAggregator({ idFactory: deterministicIdFactory });
    const payload = '{"emoji":"👩‍💻","cjk":"漢字"}';
    const chunkSize = 4;
    const chunks: string[] = [];
    for (let cursor = 0; cursor < payload.length; cursor += chunkSize) {
      chunks.push(payload.slice(cursor, cursor + chunkSize));
    }

    chunks.forEach((segment, index) => {
      const deltaPayload =
        index === 0
          ? {
              tool_calls: [
                {
                  index: 0,
                  function: { name: "utf8Tool", arguments: segment },
                },
              ],
            }
          : {
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: segment },
                },
              ],
            };
      const delta = aggregator.ingestDelta(deltaPayload);
      expect(delta.updated).toBe(true);
    });

    const snapshot = aggregator.snapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].function.name).toBe("utf8Tool");
    expect(snapshot[0].function.arguments).toBe(payload);
    expect(() =>
      Buffer.from(snapshot[0].function.arguments, "utf8").toString("utf8")
    ).not.toThrow();
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

  it("skips invalid text matcher registrations and suppresses warnings in production", () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const warnSpy =
      typeof process.emitWarning === "function"
        ? vi.spyOn(process, "emitWarning").mockImplementation(() => {})
        : vi.spyOn(console, "warn").mockImplementation(() => {});

    const noop = registerTextPattern("", () => {});
    expect(typeof noop).toBe("function");
    const unregister = registerTextPattern("badMatcherProd", () => {
      throw new Error("boom");
    });

    const result = extractUseToolBlocks("<use_tool><name>x</name></use_tool>", 0);
    expect(result.blocks.length).toBeGreaterThan(0);
    expect(warnSpy).not.toHaveBeenCalled();

    unregister();
    warnSpy.mockRestore();
    if (originalEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it("parses JSON-only use_tool blocks with name and fields", () => {
    const payload = '<use_tool>{"name":"alpha","path":"/tmp","query":"q"}</use_tool>';
    const result = extractUseToolBlocks(payload, 0);

    expect(result.blocks[0].name).toBe("alpha");
    expect(result.blocks[0].path).toBe("/tmp");
    expect(result.blocks[0].query).toBe("q");
    expect(result.blocks[0].argsText).toContain('"query":"q"');
  });

  it("reuses call ids across alias fields and updates arguments", () => {
    const aggregator = createToolCallAggregator({ idFactory: deterministicIdFactory });
    aggregator.ingestDelta({
      tool_calls: [
        {
          tool_call_id: "call_1",
          function: { name: "alpha", arguments: '{"x":' },
        },
      ],
    });
    aggregator.ingestDelta({
      tool_calls: [
        {
          call_id: "call_1",
          function: { arguments: '"1"}' },
        },
      ],
    });

    const snapshot = aggregator.snapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].function.arguments).toBe('{"x":"1"}');
  });

  it("ingests response output item events and argument completion", () => {
    const aggregator = createToolCallAggregator({ idFactory: deterministicIdFactory });
    const added = aggregator.ingestDelta({
      type: "response.output_item.added",
      item: { id: "item_1", type: "function_call", name: "calc" },
    });
    expect(added.updated).toBe(true);

    aggregator.ingestDelta({
      type: "response.function_call_arguments.delta",
      item_id: "item_1",
      delta: '{"a":',
    });
    aggregator.ingestMessage({
      type: "response.function_call_arguments.done",
      item_id: "item_1",
      arguments: '{"a":1}',
    });

    const snapshot = aggregator.snapshot();
    expect(snapshot[0].function).toEqual({ name: "calc", arguments: '{"a":1}' });
  });

  it("synthesizes textual tool calls from array content", () => {
    const aggregator = createToolCallAggregator({ idFactory: deterministicIdFactory });
    const payload = {
      message: {
        content: ['<use_tool><name>lookup</name><args>{"id":42}</args></use_tool>'],
      },
    };
    const result = aggregator.ingestMessage(payload, { emitIfMissing: true });

    expect(result.updated).toBe(true);
    expect(result.deltas[0].function.name).toBe("lookup");
    expect(result.deltas[0].function.arguments).toContain('"id":42');
  });

  it("disables parallel tool calls when nested flag is false", () => {
    const aggregator = createToolCallAggregator();
    aggregator.ingestDelta([
      {
        parallelToolCalls: false,
        tool_calls: [{ index: 0, function: { name: "serial", arguments: "{}" } }],
      },
    ]);

    expect(aggregator.supportsParallelCalls()).toBe(false);
  });

  it("ingests function_call payloads and replaces arguments", () => {
    const aggregator = createToolCallAggregator({ idFactory: deterministicIdFactory });
    aggregator.ingestDelta({
      function_call: { name: "legacy", arguments: '{"a":' },
    });
    aggregator.ingestDelta({
      function_call: { arguments: '{"a":1}' },
    });

    const snapshot = aggregator.snapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].function.arguments).toBe('{"a":1}');
  });

  it("supports alternate argument keys and tool_call_index aliases", () => {
    const aggregator = createToolCallAggregator({ idFactory: deterministicIdFactory });
    aggregator.ingestDelta({
      tool_calls: [
        {
          tool_call_index: "1",
          function: { name: "alpha", arguments_chunk: '{"x":' },
        },
      ],
    });
    aggregator.ingestDelta({
      tool_calls: [
        {
          toolCallIndex: 1,
          function: { argumentsChunk: '"y"}' },
        },
      ],
    });

    const snapshot = aggregator.snapshot({ choiceIndex: 0 });
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].function.arguments).toBe('{"x":"y"}');
  });

  it("clears all tool calls when resetTurn is called without a choice index", () => {
    const aggregator = createToolCallAggregator({ idFactory: deterministicIdFactory });
    aggregator.ingestDelta({
      tool_calls: [{ index: 0, function: { name: "one", arguments: "{}" } }],
    });
    aggregator.ingestDelta({
      tool_calls: [{ index: 1, function: { name: "two", arguments: "{}" } }],
    });

    expect(aggregator.hasCalls()).toBe(true);
    aggregator.resetTurn();
    expect(aggregator.hasCalls()).toBe(false);
  });
});
