import { describe, test, expect } from "vitest";
import {
  coerceInputToChatMessages,
  mapChoiceToOutput,
  convertChatResponseToResponses,
  buildStreamingEnvelope,
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
});
