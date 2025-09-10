import { describe, it, expect } from "vitest";
import { extractUseToolBlocks } from "../../src/dev-logging.js";

describe("extractUseToolBlocks", () => {
  it("parses inner <name>, <path>, <query>", () => {
    const text =
      "before <use_tool>\n<name>web.search</name>\n<path>/docs</path>\n<query>vitest</query>\n</use_tool> after";
    const { blocks, nextPos } = extractUseToolBlocks(text, 0);
    expect(nextPos).toBeGreaterThan(0);
    expect(blocks.length).toBe(1);
    const b = blocks[0];
    expect(b.name).toBe("web.search");
    expect(b.path).toBe("/docs");
    expect(b.query).toBe("vitest");
    expect(text.slice(b.start, b.end)).toContain("</use_tool>");
  });

  it("parses name from attribute when inner missing", () => {
    const text =
      '<use_tool name="code_index.search"><path>src</path><query>normalizeModel</query></use_tool>';
    const { blocks } = extractUseToolBlocks(text);
    expect(blocks.length).toBe(1);
    expect(blocks[0].name).toBe("code_index.search");
    expect(blocks[0].path).toBe("src");
    expect(blocks[0].query).toBe("normalizeModel");
  });

  it("parses path/query from JSON body when tags absent", () => {
    const text = '<use_tool>{"name":"openmemory.search","path":"/","query":"q"}</use_tool>';
    const { blocks } = extractUseToolBlocks(text);
    expect(blocks.length).toBe(1);
    expect(blocks[0].path).toBe("/");
    expect(blocks[0].query).toBe("q");
  });
});
