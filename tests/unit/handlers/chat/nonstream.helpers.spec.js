import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const extractUseToolBlocksMock = vi.fn();
const originalEnv = {
  PROXY_TOOL_BLOCK_DEDUP: process.env.PROXY_TOOL_BLOCK_DEDUP,
  PROXY_TOOL_BLOCK_DELIMITER: process.env.PROXY_TOOL_BLOCK_DELIMITER,
  PROXY_TOOL_BLOCK_MAX: process.env.PROXY_TOOL_BLOCK_MAX,
};

vi.mock("../../../../src/dev-logging.js", () => ({
  LOG_PROTO: false,
  appendUsage: vi.fn(),
  appendProtoEvent: vi.fn(),
  extractUseToolBlocks: (...args) => extractUseToolBlocksMock(...args),
  logSanitizerSummary: vi.fn(),
  logSanitizerToggle: vi.fn(),
}));

const restoreEnv = () => {
  if (originalEnv.PROXY_TOOL_BLOCK_DEDUP === undefined) {
    delete process.env.PROXY_TOOL_BLOCK_DEDUP;
  } else {
    process.env.PROXY_TOOL_BLOCK_DEDUP = originalEnv.PROXY_TOOL_BLOCK_DEDUP;
  }
  if (originalEnv.PROXY_TOOL_BLOCK_DELIMITER === undefined) {
    delete process.env.PROXY_TOOL_BLOCK_DELIMITER;
  } else {
    process.env.PROXY_TOOL_BLOCK_DELIMITER = originalEnv.PROXY_TOOL_BLOCK_DELIMITER;
  }
  if (originalEnv.PROXY_TOOL_BLOCK_MAX === undefined) {
    delete process.env.PROXY_TOOL_BLOCK_MAX;
  } else {
    process.env.PROXY_TOOL_BLOCK_MAX = originalEnv.PROXY_TOOL_BLOCK_MAX;
  }
};

const buildRecord = (name, args) => ({
  id: `tool_${name}`,
  type: "function",
  function: {
    name,
    arguments: args,
  },
});

const loadHelpers = async () => {
  vi.resetModules();
  return await import("../../../../src/handlers/chat/nonstream.js");
};

beforeEach(() => {
  process.env.PROXY_TOOL_BLOCK_DEDUP = "true";
  process.env.PROXY_TOOL_BLOCK_DELIMITER = "\\n\\n";
  process.env.PROXY_TOOL_BLOCK_MAX = "0";
  extractUseToolBlocksMock.mockReset();
});

afterEach(() => {
  restoreEnv();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("chat nonstream helper behavior", () => {
  it("returns null for empty canonical xml inputs", async () => {
    const { buildCanonicalXml } = await loadHelpers();

    expect(buildCanonicalXml()).toBeNull();
    expect(buildCanonicalXml([])).toBeNull();
  });

  it("returns null when canonical xml has no valid args", async () => {
    const { buildCanonicalXml } = await loadHelpers();

    const snapshot = [
      { id: "tool_alpha", type: "function", function: { name: "alpha", arguments: "" } },
      { type: "function", function: { name: "beta" } },
      null,
    ];

    expect(buildCanonicalXml(snapshot)).toBeNull();
  });

  it("builds canonical xml with dedupe and skips invalid JSON", async () => {
    const { buildCanonicalXml } = await loadHelpers();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const snapshot = [
      buildRecord("lookup_user", JSON.stringify({ id: "1" })),
      buildRecord("lookup_user", JSON.stringify({ id: "1" })),
      buildRecord("send_email", "{ bad-json"),
    ];

    const xml = buildCanonicalXml(snapshot);

    expect(xml).toContain("<use_tool>");
    expect((xml.match(/<use_tool>/g) || []).length).toBe(1);
    expect(xml).toContain("lookup_user");
    consoleSpy.mockRestore();
  });

  it("respects max tool block count when building xml", async () => {
    process.env.PROXY_TOOL_BLOCK_MAX = "1";
    const { buildCanonicalXml } = await loadHelpers();

    const snapshot = [
      buildRecord("lookup_user", JSON.stringify({ id: "1" })),
      buildRecord("send_email", JSON.stringify({ id: "2" })),
    ];

    const xml = buildCanonicalXml(snapshot);

    expect((xml.match(/<use_tool>/g) || []).length).toBe(1);
  });

  it("extracts unique textual tool blocks with delimiter", async () => {
    const { extractTextualUseToolBlock } = await loadHelpers();
    const text = "<use_tool>one</use_tool><use_tool>two</use_tool>";
    const firstEnd = text.indexOf("</use_tool>") + "</use_tool>".length;
    const secondStart = text.indexOf("<use_tool>", firstEnd);
    const secondEnd = text.indexOf("</use_tool>", secondStart) + "</use_tool>".length;

    extractUseToolBlocksMock.mockReturnValue({
      blocks: [
        { start: 0, end: firstEnd },
        { indexStart: 0, indexEnd: firstEnd },
        { start: secondStart, end: secondEnd },
      ],
      nextPos: secondEnd,
    });

    const result = extractTextualUseToolBlock(text);

    expect(result).toContain("one");
    expect(result).toContain("two");
    expect(result.split("\n\n").length).toBe(2);
  });

  it("returns null when no textual tool blocks are detected", async () => {
    const { extractTextualUseToolBlock } = await loadHelpers();
    extractUseToolBlocksMock.mockReturnValue({ blocks: [], nextPos: 0 });

    expect(extractTextualUseToolBlock("<use_tool>nope</use_tool>")).toBeNull();
  });

  it("returns null for empty textual tool content", async () => {
    const { extractTextualUseToolBlock } = await loadHelpers();

    expect(extractTextualUseToolBlock("")).toBeNull();
  });

  it("uses index-based block offsets and skips empty literals", async () => {
    const { extractTextualUseToolBlock } = await loadHelpers();
    const text = "<use_tool>one</use_tool>";

    extractUseToolBlocksMock.mockReturnValue({
      blocks: [
        { indexStart: 0, indexEnd: text.length },
        { start: 0, end: 0 },
      ],
      nextPos: text.length,
    });

    const result = extractTextualUseToolBlock(text);

    expect(result).toContain("<use_tool>");
  });

  it("returns null when parsing textual tool blocks throws", async () => {
    const { extractTextualUseToolBlock } = await loadHelpers();
    extractUseToolBlocksMock.mockImplementation(() => {
      throw new Error("boom");
    });

    expect(extractTextualUseToolBlock("<use_tool>oops</use_tool>")).toBeNull();
  });

  it("joins tool blocks when dedupe is disabled and delimiter is empty", async () => {
    process.env.PROXY_TOOL_BLOCK_DEDUP = "false";
    process.env.PROXY_TOOL_BLOCK_DELIMITER = "";
    const { extractTextualUseToolBlock } = await loadHelpers();
    const text = "<use_tool>one</use_tool><use_tool>two</use_tool>";
    const firstEnd = text.indexOf("</use_tool>") + "</use_tool>".length;
    const secondStart = text.indexOf("<use_tool>", firstEnd);
    const secondEnd = text.indexOf("</use_tool>", secondStart) + "</use_tool>".length;

    extractUseToolBlocksMock.mockReturnValue({
      blocks: [
        { start: 0, end: firstEnd },
        { start: secondStart, end: secondEnd },
      ],
      nextPos: secondEnd,
    });

    expect(extractTextualUseToolBlock(text)).toBe(text);
  });

  it("builds assistant message with content_filter", async () => {
    const { buildAssistantMessage } = await loadHelpers();

    const result = buildAssistantMessage({
      canonicalReason: "content_filter",
      choiceContent: "blocked",
    });

    expect(result.message.content).toBeNull();
    expect(result.hasToolCalls).toBe(false);
  });

  it("builds assistant message for tool calls without obsidian output", async () => {
    const { buildAssistantMessage } = await loadHelpers();
    const snapshot = [buildRecord("lookup_user", JSON.stringify({ id: "1" }))];

    const result = buildAssistantMessage({
      snapshot,
      choiceContent: "ignored",
      isObsidianOutput: false,
    });

    expect(result.message.tool_calls).toHaveLength(1);
    expect(result.message.content).toBeNull();
  });

  it("builds assistant message with function_call payload", async () => {
    const { buildAssistantMessage } = await loadHelpers();

    const result = buildAssistantMessage({
      choiceContent: "ignored",
      functionCallPayload: { name: "do_thing", arguments: "{}" },
    });

    expect(result.message.function_call).toEqual({ name: "do_thing", arguments: "{}" });
    expect(result.message.content).toBeNull();
  });

  it("falls back to textual tool blocks when canonical xml is empty", async () => {
    process.env.PROXY_TOOL_BLOCK_MAX = "1";
    const { buildAssistantMessage } = await loadHelpers();

    const snapshot = [
      buildRecord("lookup_user", "{bad json"),
      { type: "function", function: { name: "send_email", arguments: "{bad json" } },
    ];
    const text = "<use_tool>one</use_tool><use_tool>two</use_tool>";
    const firstEnd = text.indexOf("</use_tool>") + "</use_tool>".length;
    const secondStart = text.indexOf("<use_tool>", firstEnd);
    const secondEnd = text.indexOf("</use_tool>", secondStart) + "</use_tool>".length;

    extractUseToolBlocksMock.mockReturnValue({
      blocks: [
        { start: 0, end: firstEnd },
        { start: secondStart, end: secondEnd },
      ],
      nextPos: secondEnd,
    });

    const result = buildAssistantMessage({
      snapshot,
      choiceContent: text,
      isObsidianOutput: true,
    });

    expect(result.message.content).toContain("<use_tool>");
    expect(result.toolCallsTruncated).toBe(true);
    expect(result.hasToolCalls).toBe(true);
  });

  it("prefers canonical xml for obsidian output when available", async () => {
    const { buildAssistantMessage } = await loadHelpers();
    const snapshot = [
      { type: "function", function: { name: "lookup_user", arguments: '{"id":1}' } },
    ];

    const result = buildAssistantMessage({
      snapshot,
      choiceContent: "ignored",
      isObsidianOutput: true,
    });

    expect(result.message.content).toContain("<use_tool>");
    expect(result.message.tool_calls).toHaveLength(1);
  });

  it("handles non-object function fields in tool call records", async () => {
    const { buildAssistantMessage } = await loadHelpers();
    const snapshot = [{ type: "function", function: "noop", id: "tool-x" }];

    const result = buildAssistantMessage({ snapshot });

    expect(result.message.tool_calls?.[0]?.function).toBe("noop");
  });

  it("accepts null snapshot inputs without tool calls", async () => {
    const { buildAssistantMessage } = await loadHelpers();

    const result = buildAssistantMessage({ snapshot: null });

    expect(result.toolCallCount).toBe(0);
  });

  it("trims trailing content after use_tool blocks", async () => {
    const { buildAssistantMessage } = await loadHelpers();

    const result = buildAssistantMessage({
      choiceContent: "before <use_tool>call</use_tool> after",
    });

    expect(result.message.content).toBe("before <use_tool>call</use_tool>");
  });
});
