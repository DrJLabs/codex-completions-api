import { describe, test, expect } from "vitest";
import {
  applyDefaultProxyOutputModeHeader,
  coerceInputToChatMessages,
  initializeStreamingState,
  mapChoiceToOutput,
  convertChatResponseToResponses,
  buildStreamingEnvelope,
  normalizeMessageId,
  normalizeResponseId,
  resolveResponsesOutputMode,
  updateStreamingToolCalls,
} from "../../src/handlers/responses/shared.js";

describe("responses shared helpers", () => {
  test("coerceInputToChatMessages respects existing messages", () => {
    const original = [{ role: "user", content: "hi" }];
    const result = coerceInputToChatMessages({ messages: original });
    expect(result).toEqual(original);
  });

  test("coerceInputToChatMessages builds messages from instructions and array input", () => {
    const body = {
      instructions: "Be formal",
      input: [
        { type: "input_text", text: "Please help" },
        { type: "input_text", text: "with tests" },
      ],
    };
    const result = coerceInputToChatMessages(body);
    expect(result).toEqual([
      { role: "system", content: "Be formal" },
      { role: "user", content: "Please help with tests" },
    ]);
  });

  test("coerceInputToChatMessages handles message items with string content", () => {
    const body = {
      input: [{ type: "message", role: "user", content: "Say hello." }],
    };
    const result = coerceInputToChatMessages(body);
    expect(result).toEqual([{ role: "user", content: "Say hello." }]);
  });

  test("mapChoiceToOutput converts tool calls into tool_use nodes", () => {
    const choice = {
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "lookup_user",
              arguments: '{"id":"42"}',
            },
          },
        ],
      },
    };
    const result = mapChoiceToOutput(choice, 0);
    expect(result.content).toEqual([
      {
        type: "tool_use",
        id: expect.any(String),
        name: "lookup_user",
        input: { id: "42" },
      },
    ]);
  });

  test("convertChatResponseToResponses normalizes ids and preserves previous_response_id", () => {
    const payload = {
      id: "chatcmpl-abc",
      model: "codex-5",
      usage: { prompt_tokens: 5, completion_tokens: 3 },
      choices: [
        {
          finish_reason: "stop",
          message: {
            id: "msg-1",
            role: "assistant",
            content: "Hello",
          },
        },
      ],
    };
    const response = convertChatResponseToResponses(payload, {
      previous_response_id: "resp_prev",
    });
    expect(response.id.startsWith("resp_")).toBe(true);
    expect(response.status).toBe("completed");
    expect(response.output[0].id.startsWith("msg_")).toBe(true);
    expect(response.previous_response_id).toBe("resp_prev");
    expect(response.usage).toEqual({ input_tokens: 5, output_tokens: 3, total_tokens: 8 });
  });

  test("buildStreamingEnvelope merges text, tool calls, and usage", () => {
    const toolCalls = new Map();
    toolCalls.set(0, {
      id: "tool_known",
      type: "function",
      function: { name: "lookup_user", arguments: '{"id":"42"}' },
    });
    const state = {
      messageId: "msg_static",
      responseId: "resp_static",
      model: "codex-5",
      role: "assistant",
    };
    const envelope = buildStreamingEnvelope({
      state,
      requestBody: { previous_response_id: "resp_prev" },
      usage: { prompt_tokens: 5, completion_tokens: 1 },
      status: "completed",
      textSegments: ["Hello"],
      toolCalls,
    });
    expect(envelope).toEqual({
      id: "resp_static",
      status: "completed",
      model: "codex-5",
      output: [
        {
          id: "msg_static",
          type: "message",
          role: "assistant",
          content: [
            { type: "output_text", text: "Hello" },
            {
              type: "tool_use",
              id: "tool_known",
              name: "lookup_user",
              input: { id: "42" },
            },
          ],
        },
      ],
      usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 },
      previous_response_id: "resp_prev",
    });
  });

  test("normalizes response/message ids and strips prefixes", () => {
    expect(normalizeResponseId("resp_abc")).toBe("resp_abc");
    expect(normalizeResponseId("chatcmpl-xyz")).toBe("resp_xyz");
    expect(normalizeResponseId("  bad*id  ")).toBe("resp_badid");
    expect(normalizeMessageId("msg_123")).toBe("msg_123");
    expect(normalizeMessageId("  bad*id  ")).toBe("msg_badid");
  });

  test("resolves responses output mode from header, copilot, or default", () => {
    const headerReq = { headers: { "x-proxy-output-mode": "xml" } };
    expect(
      resolveResponsesOutputMode({
        req: headerReq,
        defaultValue: "text",
        copilotDefault: "copilot",
      })
    ).toEqual({ effective: "xml", source: "header" });

    const copilotReq = { headers: { "user-agent": "Obsidian/1.0" } };
    expect(
      resolveResponsesOutputMode({
        req: copilotReq,
        defaultValue: "text",
        copilotDefault: "copilot",
      })
    ).toEqual({ effective: "copilot", source: "copilot" });

    const fallbackReq = { headers: {} };
    expect(
      resolveResponsesOutputMode({
        req: fallbackReq,
        defaultValue: "text",
        copilotDefault: "copilot",
        copilotDetection: { copilot_detect_tier: "low" },
      })
    ).toEqual({ effective: "text", source: "default" });
  });

  test("applyDefaultProxyOutputModeHeader sets and restores headers", () => {
    const req = { headers: {} };
    const restore = applyDefaultProxyOutputModeHeader(req, "xml");

    expect(req.headers["x-proxy-output-mode"]).toBe("xml");
    restore();
    expect(req.headers["x-proxy-output-mode"]).toBeUndefined();

    const existing = { headers: { "x-proxy-output-mode": "keep" } };
    const noop = applyDefaultProxyOutputModeHeader(existing, "xml");
    noop();
    expect(existing.headers["x-proxy-output-mode"]).toBe("keep");
  });

  test("updates streaming tool calls with deltas", () => {
    const toolCalls = new Map();

    updateStreamingToolCalls(
      [
        {
          index: 0,
          id: "call_1",
          type: "function",
          function: { name: "lookup", arguments: "{" },
        },
      ],
      toolCalls
    );
    updateStreamingToolCalls(
      [
        {
          index: 0,
          function: { arguments: '"id":1}' },
        },
      ],
      toolCalls
    );

    const call = toolCalls.get(0);
    expect(call.function.arguments).toBe('{"id":1}');
    updateStreamingToolCalls(null, toolCalls);
    expect(toolCalls.size).toBe(1);
  });

  test("buildStreamingEnvelope supplies empty output text by default", () => {
    const state = initializeStreamingState();
    state.messageId = "msg_empty";
    state.responseId = "resp_empty";
    state.model = "codex-5";

    const envelope = buildStreamingEnvelope({
      state,
      requestBody: {},
      usage: null,
      status: "completed",
      textSegments: [],
      toolCalls: new Map(),
    });

    expect(envelope.output[0].content).toEqual([{ type: "output_text", text: "" }]);
  });
});
