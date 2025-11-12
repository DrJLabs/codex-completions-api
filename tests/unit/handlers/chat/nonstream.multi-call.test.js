import { describe, expect, test } from "vitest";
import { buildAssistantMessage } from "../../../../src/handlers/chat/nonstream.js";

const buildSnapshot = (payloads = []) =>
  payloads.map((payload, idx) => ({
    id: payload.id || `tool_multi_${idx}`,
    type: "function",
    function: {
      name: payload.name || (idx % 2 === 0 ? "lookup_user" : "send_email"),
      arguments: payload.arguments || JSON.stringify({ id: String(100 + idx) }),
    },
  }));

const buildXmlChoice = (count = 3) => buildSnapshot(Array.from({ length: count }, () => ({})));

describe("chat non-stream multi-call helpers", () => {
  test("reports toolCallCount for every canonical record and preserves XML order", () => {
    const snapshot = buildXmlChoice(3);
    const { message, toolCallCount, toolCallsTruncated } = buildAssistantMessage({
      snapshot,
      choiceContent: "",
      normalizedContent: "",
      canonicalReason: "tool_calls",
      isObsidianOutput: true,
    });

    expect(toolCallCount).toBe(3);
    expect(toolCallsTruncated).toBe(false);
    expect(message.tool_calls).toHaveLength(3);
    const firstIdx = message.content.indexOf("lookup_user");
    const secondIdx = message.content.indexOf("send_email");
    expect(firstIdx).toBeGreaterThanOrEqual(0);
    expect(secondIdx).toBeGreaterThan(firstIdx);
    expect((message.content.match(/<use_tool>/g) || []).length).toBe(3);
  });

  test("falls back to textual <use_tool> parsing when canonical XML cannot be built", () => {
    const snapshot = buildSnapshot([
      { name: "lookup_user", arguments: JSON.stringify({ id: "42" }) },
      { name: "send_email", arguments: "not-json" },
    ]);
    const rawContent = `leading text\n<use_tool>\n  <name>lookup_user</name>\n  <args>{"id":"42"}</args>\n</use_tool>\n<use_tool>\n  <name>send_email</name>\n  <payload>{"ticket":"alpha"}</payload>\n</use_tool>\ntrailing text`;
    const { message, toolCallCount } = buildAssistantMessage({
      snapshot,
      choiceContent: rawContent,
      normalizedContent: rawContent,
      canonicalReason: "tool_calls",
      isObsidianOutput: true,
    });

    expect(toolCallCount).toBe(2);
    expect(message.tool_calls).toHaveLength(2);
    expect(message.content.startsWith("leading text")).toBe(false);
    expect(message.content.includes("trailing text")).toBe(false);
    expect(message.content.trim().endsWith("</use_tool>")).toBe(true);
  });

  test("openai-json mode nulls assistant content but retains every tool call", () => {
    const snapshot = buildXmlChoice(2);
    const { message, toolCallCount } = buildAssistantMessage({
      snapshot,
      choiceContent: "assistant summary",
      normalizedContent: "assistant summary",
      canonicalReason: "tool_calls",
      isObsidianOutput: false,
    });

    expect(toolCallCount).toBe(2);
    expect(message.content).toBeNull();
    expect(Array.isArray(message.tool_calls)).toBe(true);
    expect(message.tool_calls).toHaveLength(2);
  });
});
