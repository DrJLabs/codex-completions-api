import { describe, expect, test } from "vitest";
import { buildAssistantMessage } from "../../../../src/handlers/chat/nonstream.js";
import { config as CFG } from "../../../../src/config/index.js";

const buildSnapshot = (count = 1) =>
  Array.from({ length: count }, (_, idx) => ({
    id: `tool_fake_${idx + 1}`,
    type: "function",
    function: {
      name: idx % 2 === 0 ? "lookup_user" : "send_email",
      arguments: JSON.stringify({ id: String(42 + idx) }),
    },
  }));

describe("chat non-stream assistant message builder", () => {
  test("obsidian output surfaces <use_tool> XML while keeping tool metadata", () => {
    const { message, hasToolCalls } = buildAssistantMessage({
      snapshot: buildSnapshot(1),
      choiceContent: "",
      normalizedContent: "",
      canonicalReason: "stop",
      isObsidianOutput: true,
    });

    expect(hasToolCalls).toBe(true);
    expect(Array.isArray(message.tool_calls)).toBe(true);
    expect(message.tool_calls).toHaveLength(1);
    expect(message.content).toContain("<use_tool>");
    expect(message.content).toContain("<name>lookup_user</name>");
    expect(message.content.trim().endsWith("</use_tool>")).toBe(true);
  });

  test("openai-json output keeps tool_calls array but nulls assistant content", () => {
    const { message } = buildAssistantMessage({
      snapshot: buildSnapshot(1),
      choiceContent: "",
      normalizedContent: "",
      canonicalReason: "stop",
      isObsidianOutput: false,
    });

    expect(message.content).toBeNull();
    expect(message.tool_calls).toHaveLength(1);
    expect(message.tool_calls[0].function.arguments).toBe('{"id":"42"}');
  });

  test("obsidian output concatenates every tool block in snapshot order", () => {
    const { message } = buildAssistantMessage({
      snapshot: buildSnapshot(2),
      choiceContent: "",
      normalizedContent: "",
      canonicalReason: "stop",
      isObsidianOutput: true,
    });

    const occurrences = message.content.match(/<use_tool>/g) || [];
    expect(occurrences).toHaveLength(2);
    expect(message.tool_calls).toHaveLength(2);
  });

  test("textual fallback preserves multiple <use_tool> blocks and trims tail text", () => {
    const rawContent = `intro
<use_tool>\n  <name>lookup_user</name>\n  <id>42</id>\n</use_tool>
<use_tool>\n  <name>send_email</name>\n  <ticket>abc</ticket>\n</use_tool>
ignored`;
    const { message } = buildAssistantMessage({
      snapshot: [],
      choiceContent: rawContent,
      normalizedContent: "",
      canonicalReason: "stop",
      isObsidianOutput: true,
    });

    const occurrences = message.content.match(/<use_tool>/g) || [];
    expect(occurrences).toHaveLength(2);
    expect(message.content).not.toContain("ignored");
    expect(message.content.trim().endsWith("</use_tool>")).toBe(true);
  });

  test("respects PROXY_TOOL_BLOCK_MAX limit for non-stream responses", () => {
    const originalMax = CFG.PROXY_TOOL_BLOCK_MAX;
    let result;
    try {
      CFG.PROXY_TOOL_BLOCK_MAX = 1;
      result = buildAssistantMessage({
        snapshot: buildSnapshot(2),
        choiceContent: "",
        normalizedContent: "",
        canonicalReason: "stop",
        isObsidianOutput: true,
      });
    } finally {
      CFG.PROXY_TOOL_BLOCK_MAX = originalMax;
    }
    const { message, toolCallsTruncated } = result;
    expect(message.tool_calls).toHaveLength(1);
    expect(toolCallsTruncated).toBe(true);
  });

  test("content_filter forces null assistant content", () => {
    const { message } = buildAssistantMessage({
      snapshot: [],
      choiceContent: "blocked",
      normalizedContent: "blocked",
      canonicalReason: "content_filter",
      isObsidianOutput: true,
    });

    expect(message.content).toBeNull();
  });

  test("function_call payload uses function_call and null content", () => {
    const { message } = buildAssistantMessage({
      snapshot: [],
      choiceContent: "ignored",
      normalizedContent: "",
      canonicalReason: "stop",
      isObsidianOutput: true,
      functionCallPayload: { name: "lookup", arguments: "{}" },
    });

    expect(message.function_call).toMatchObject({ name: "lookup" });
    expect(message.content).toBeNull();
  });
});
