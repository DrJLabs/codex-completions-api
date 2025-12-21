import { describe, expect, test } from "vitest";
import {
  summarizeText,
  summarizeToolCalls,
  summarizeToolUseItems,
} from "../../src/lib/observability/transform-summary.js";

describe("transform summary helpers", () => {
  test("summarizeText detects xml markers and hashes", () => {
    const summary = summarizeText("hello <use_tool>stuff</use_tool>");
    expect(summary.xml_in_text).toBe(true);
    expect(summary.output_text_bytes).toBeGreaterThan(0);
    expect(summary.output_text_hash).toMatch(/[a-f0-9]{64}/);
  });

  test("summarizeToolCalls hashes arguments without exposing raw text", () => {
    const summary = summarizeToolCalls([
      { function: { name: "localSearch", arguments: '{"query":"hello"}' } },
    ]);
    expect(summary.tool_call_count).toBe(1);
    expect(summary.tool_names).toContain("localSearch");
    expect(summary.tool_args_hashes.length).toBe(1);
  });

  test("summarizeToolUseItems detects tool_use entries", () => {
    const summary = summarizeToolUseItems([
      {
        type: "message",
        content: [
          { type: "output_text", text: "hi" },
          { type: "tool_use", name: "writeToFile", input: {} },
        ],
      },
    ]);
    expect(summary.tool_use_count).toBe(1);
    expect(summary.tool_use_names).toContain("writeToFile");
  });
});
