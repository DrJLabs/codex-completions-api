import { describe, test, expect, vi } from "vitest";
import * as schema from "../../../../src/services/logging/schema.js";
import {
  summarizeResponsesIngress,
  logResponsesIngressRaw,
} from "../../../../src/handlers/responses/ingress-logging.js";

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

describe("responses ingress raw logging", () => {
  test("logs header-sourced copilot trace", () => {
    const spy = vi.spyOn(schema, "logStructured").mockReturnValue({});
    const req = { method: "POST", headers: { "x-copilot-trace-id": "copilot-123" } };
    const res = { locals: {} };
    logResponsesIngressRaw({ req, res, body: { input: "hi" } });
    const [, extras] = spy.mock.calls[0];
    expect(extras.copilot_trace_id).toBe("copilot-123");
    expect(extras.copilot_trace_source).toBe("header");
    expect(extras.copilot_trace_header).toBe("x-copilot-trace-id");
    spy.mockRestore();
  });

  test("logs generated copilot trace when header missing", () => {
    const spy = vi.spyOn(schema, "logStructured").mockReturnValue({});
    const req = { method: "POST", headers: {} };
    const res = { locals: {} };
    logResponsesIngressRaw({ req, res, body: { input: "hi" } });
    const [, extras] = spy.mock.calls[0];
    expect(extras.copilot_trace_source).toBe("generated");
    expect(extras.copilot_trace_header).toBe(null);
    expect(typeof extras.copilot_trace_id).toBe("string");
    spy.mockRestore();
  });
});
