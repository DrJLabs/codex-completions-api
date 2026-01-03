import { describe, expect, it } from "vitest";
import {
  normalizeToolCallSnapshot,
  buildCanonicalXml,
  extractTextualUseToolBlock,
  trimTrailingTextAfterToolBlocks,
} from "../../../../src/handlers/chat/tool-output.js";

const buildRecord = (name, args, id = `tool_${name}`) => ({
  id,
  type: "function",
  function: { name, arguments: args },
});

describe("tool output helpers", () => {
  it("dedupes and truncates tool call snapshots", () => {
    const snapshot = [
      buildRecord("alpha", JSON.stringify({ id: 1 }), "dup"),
      buildRecord("alpha", JSON.stringify({ id: 1 }), "dup"),
      buildRecord("beta", JSON.stringify({ id: 2 }), "beta"),
    ];

    const result = normalizeToolCallSnapshot(snapshot, { maxBlocks: 1, dedupe: true });

    expect(result.records).toHaveLength(1);
    expect(result.truncated).toBe(true);
    expect(result.observedCount).toBe(2);
  });

  it("builds canonical xml with a custom serializer", () => {
    const snapshot = [buildRecord("lookup", JSON.stringify({ id: 1 }))];

    const xml = buildCanonicalXml(snapshot, {
      delimiter: "\n",
      toXml: (record) => `<use_tool>${record.function.name}</use_tool>`,
    });

    expect(xml).toBe("<use_tool>lookup</use_tool>");
  });

  it("extracts textual tool blocks and trims trailing text", () => {
    const text = "<use_tool>one</use_tool><use_tool>two</use_tool> trailing";
    const extractBlocks = () => ({
      blocks: [
        { start: 0, end: "<use_tool>one</use_tool>".length },
        {
          start: "<use_tool>one</use_tool>".length,
          end: "<use_tool>one</use_tool><use_tool>two</use_tool>".length,
        },
      ],
      nextPos: text.length,
    });

    const extracted = extractTextualUseToolBlock(text, {
      delimiter: "\n\n",
      dedupe: false,
      extractBlocks,
    });

    expect(extracted.split("\n\n")).toHaveLength(2);
    expect(trimTrailingTextAfterToolBlocks(text)).toBe(
      "<use_tool>one</use_tool><use_tool>two</use_tool>"
    );
  });
});
