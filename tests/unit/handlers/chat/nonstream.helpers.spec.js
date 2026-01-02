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

  it("returns null when parsing textual tool blocks throws", async () => {
    const { extractTextualUseToolBlock } = await loadHelpers();
    extractUseToolBlocksMock.mockImplementation(() => {
      throw new Error("boom");
    });

    expect(extractTextualUseToolBlock("<use_tool>oops</use_tool>")).toBeNull();
  });
});
