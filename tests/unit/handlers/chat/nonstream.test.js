import { describe, expect, test } from "vitest";
import { buildAssistantMessage } from "../../../../src/handlers/chat/nonstream.js";

const buildSnapshot = () => [
  {
    id: "tool_fake_1",
    type: "function",
    function: {
      name: "lookup_user",
      arguments: '{"id":"42"}',
    },
  },
];

describe("chat non-stream assistant message builder", () => {
  test("obsidian output surfaces <use_tool> XML while keeping tool metadata", () => {
    const { message, hasToolCalls } = buildAssistantMessage({
      snapshot: buildSnapshot(),
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
      snapshot: buildSnapshot(),
      choiceContent: "",
      normalizedContent: "",
      canonicalReason: "stop",
      isObsidianOutput: false,
    });

    expect(message.content).toBeNull();
    expect(message.tool_calls).toHaveLength(1);
    expect(message.tool_calls[0].function.arguments).toBe('{"id":"42"}');
  });

  test("textual fallback strips tail text once <use_tool> block is emitted", () => {
    const rawContent = `intro
<use_tool>\n  <name>lookup_user</name>\n  <id>42</id>\n</use_tool>\nignored`;
    const { message } = buildAssistantMessage({
      snapshot: buildSnapshot(),
      choiceContent: rawContent,
      normalizedContent: "",
      canonicalReason: "stop",
      isObsidianOutput: true,
    });

    expect(message.content).toContain("<use_tool>");
    expect(message.content).not.toContain("ignored");
    expect(message.content.trim().endsWith("</use_tool>")).toBe(true);
  });
});
