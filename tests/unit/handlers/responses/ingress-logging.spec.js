import { describe, test, expect } from "vitest";
import { summarizeResponsesIngress } from "../../../../src/handlers/responses/ingress-logging.js";

describe("responses ingress logging summarizer", () => {
  test("detects recent conversation and tool transcript markers", () => {
    const body = {
      model: "gpt-5.2-codev-L",
      stream: true,
      input: [
        {
          type: "message",
          role: "user",
          content:
            "<recent_conversations>...</recent_conversations>\n<use_tool>\n<name>webSearch</name>\n</use_tool>\nTool 'webSearch' result: []",
        },
      ],
    };

    const summary = summarizeResponsesIngress(body, { headers: {} });
    expect(summary.has_recent_conversations_tag).toBe(true);
    expect(summary.has_use_tool_tag).toBe(true);
    expect(summary.has_tool_result_marker).toBe(true);
  });

  test("detects markers inside array content parts", () => {
    const body = {
      input: [
        {
          type: "message",
          role: "assistant",
          content: [
            { type: "input_text", text: "prefix" },
            { type: "input_text", text: "<use_tool>noop</use_tool>" },
          ],
        },
      ],
    };
    const summary = summarizeResponsesIngress(body, { headers: {} });
    expect(summary.has_recent_conversations_tag).toBe(false);
    expect(summary.has_use_tool_tag).toBe(true);
  });

  test("defaults marker flags to false when content is absent", () => {
    const body = {
      input: [{ type: "message", role: "user", content: "" }],
    };
    const summary = summarizeResponsesIngress(body, { headers: {} });
    expect(summary.has_recent_conversations_tag).toBe(false);
    expect(summary.has_use_tool_tag).toBe(false);
    expect(summary.has_tool_result_marker).toBe(false);
  });
});
