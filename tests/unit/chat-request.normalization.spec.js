import { describe, expect, it } from "vitest";
import {
  ChatJsonRpcNormalizationError,
  normalizeChatJsonRpcRequest,
} from "../../src/handlers/chat/request.js";

const EFFECTIVE_MODEL = "gpt-5.2";

const normalize = (overrides = {}) =>
  normalizeChatJsonRpcRequest({
    effectiveModel: EFFECTIVE_MODEL,
    ...overrides,
  });

const catchNormalization = (payload) => {
  try {
    normalize(payload);
  } catch (err) {
    return err;
  }
  return null;
};

describe("normalizeChatJsonRpcRequest", () => {
  it("accepts assistant/tool history and flattens it into the prompt", () => {
    const messages = [
      { role: "system", content: "You are a bot" },
      { role: "assistant", content: "previous answer" },
      { role: "user", content: "continue" },
      { role: "tool", name: "lookup_user", content: "result payload" },
    ];

    const normalized = normalize({ body: { messages }, messages });
    expect(normalized.turn.baseInstructions).toBeUndefined();
    expect(normalized.turn.items).toHaveLength(1);
    const prompt = normalized.turn.items[0]?.data?.text || "";
    expect(prompt).not.toContain("You are a bot");
    expect(prompt).toContain("[assistant] previous answer");
    expect(prompt).toContain("[user] continue");
    expect(prompt).toContain("[tool:lookup_user] result payload");
  });

  it("accepts json_object response_format", () => {
    const messages = [{ role: "user", content: "hello" }];

    const normalized = normalize({
      body: { messages, response_format: { type: "json_object" } },
      messages,
    });

    expect(normalized.message.responseFormat).toMatchObject({ type: "json_object" });
    expect(normalized.turn.finalOutputJsonSchema).toBeUndefined();
  });

  it("accepts legacy functions and function_call aliases", () => {
    const messages = [{ role: "user", content: "hello" }];
    const functions = [
      {
        name: "do_it",
        description: "does it",
        parameters: { type: "object", properties: { path: { type: "string" } } },
      },
    ];

    const normalized = normalize({
      body: { messages, functions, function_call: { name: "do_it" } },
      messages,
    });

    expect(normalized.turn.tools?.definitions?.[0]).toMatchObject({
      type: "function",
      function: { name: "do_it" },
    });
    expect(normalized.turn.tools?.choice).toMatchObject({
      type: "function",
      function: { name: "do_it" },
    });
  });

  it("validates tool_choice strings", () => {
    const messages = [{ role: "user", content: "hello" }];
    const tools = [
      { type: "function", function: { name: "do_it", parameters: { type: "object" } } },
    ];

    const err = catchNormalization({
      body: { messages, tools, tool_choice: "forbid" },
      messages,
    });
    expect(err).toBeInstanceOf(ChatJsonRpcNormalizationError);
    expect(err?.body?.error?.param).toBe("tool_choice");
  });

  it("requires tool_choice function targets to exist", () => {
    const messages = [{ role: "user", content: "run tool" }];
    const tools = [
      { type: "function", function: { name: "available", parameters: { type: "object" } } },
    ];

    const err = catchNormalization({
      body: { messages, tools, tool_choice: { type: "function", function: { name: "missing" } } },
      messages,
    });
    expect(err).toBeInstanceOf(ChatJsonRpcNormalizationError);
    expect(err?.body?.error?.param).toBe("tool_choice.function.name");
  });

  it("rejects json_schema response_format without a schema", () => {
    const messages = [{ role: "user", content: "hello" }];
    const err = catchNormalization({
      body: { messages, response_format: { type: "json_schema" } },
      messages,
    });
    expect(err).toBeInstanceOf(ChatJsonRpcNormalizationError);
    expect(err?.body?.error?.param).toBe("response_format.json_schema");
  });

  it("rejects unsupported reasoning effort values", () => {
    const messages = [{ role: "user", content: "hello" }];
    const err = catchNormalization({
      body: { messages, reasoning: { effort: "extreme" } },
      messages,
    });
    expect(err).toBeInstanceOf(ChatJsonRpcNormalizationError);
    expect(err?.body?.error?.param).toBe("reasoning.effort");
  });

  it("keeps duplicated turn/message fields aligned after validation", () => {
    const messages = [
      { role: "system", content: "Stay short" },
      { role: "user", content: "Return JSON" },
    ];
    const tools = [
      { type: "function", function: { name: "build", parameters: { type: "object" } } },
    ];
    const responseFormat = {
      type: "json_schema",
      json_schema: {
        name: "demo",
        schema: { type: "object", properties: { answer: { type: "string" } } },
      },
    };

    const normalized = normalize({
      body: { messages, tools, tool_choice: "auto", response_format: responseFormat },
      messages,
      reasoningEffort: "low",
    });

    expect(normalized.turn.items).toEqual(normalized.message.items);
    expect(normalized.turn.tools).toEqual(normalized.message.tools);
    expect(normalized.turn.finalOutputJsonSchema).toEqual(normalized.message.finalOutputJsonSchema);
    expect(normalized.turn.effort).toBe("low");
    expect(normalized.message.reasoning).toMatchObject({ effort: "low" });
    expect(normalized.turn.choiceCount).toBeUndefined();
  });

  it("includes choiceCount on the turn when provided", () => {
    const messages = [{ role: "user", content: "hello" }];

    const normalized = normalize({
      body: { messages },
      messages,
      choiceCount: 2,
    });

    expect(normalized.turn.choiceCount).toBe(2);
  });

  it("normalizes numeric sampling controls", () => {
    const messages = [{ role: "user", content: "hello" }];

    const normalized = normalize({
      body: { messages, temperature: "1.2", top_p: "0.8", max_tokens: "16" },
      messages,
    });

    expect(normalized.message.temperature).toBe(1.2);
    expect(normalized.message.topP).toBe(0.8);
    expect(normalized.message.maxOutputTokens).toBe(16);
  });

  it("rejects non-numeric temperature values", () => {
    const messages = [{ role: "user", content: "hello" }];
    const err = catchNormalization({
      body: { messages, temperature: "hot" },
      messages,
    });

    expect(err).toBeInstanceOf(ChatJsonRpcNormalizationError);
    expect(err?.body?.error?.param).toBe("temperature");
  });

  it("rejects out-of-range temperature values", () => {
    const messages = [{ role: "user", content: "hello" }];
    const err = catchNormalization({
      body: { messages, temperature: 3 },
      messages,
    });

    expect(err).toBeInstanceOf(ChatJsonRpcNormalizationError);
    expect(err?.body?.error?.param).toBe("temperature");
  });

  it("rejects invalid top_p values", () => {
    const messages = [{ role: "user", content: "hello" }];
    const err = catchNormalization({
      body: { messages, top_p: 0 },
      messages,
    });

    expect(err).toBeInstanceOf(ChatJsonRpcNormalizationError);
    expect(err?.body?.error?.param).toBe("top_p");
  });

  it("rejects invalid max_tokens values", () => {
    const messages = [{ role: "user", content: "hello" }];
    const err = catchNormalization({
      body: { messages, max_tokens: 0 },
      messages,
    });

    expect(err).toBeInstanceOf(ChatJsonRpcNormalizationError);
    expect(err?.body?.error?.param).toBe("max_tokens");
  });

  it("rejects parallel_tool_calls when not a boolean", () => {
    const messages = [{ role: "user", content: "hello" }];
    const err = catchNormalization({
      body: { messages, parallel_tool_calls: "maybe" },
      messages,
    });

    expect(err).toBeInstanceOf(ChatJsonRpcNormalizationError);
    expect(err?.body?.error?.param).toBe("parallel_tool_calls");
  });

  it("normalizes parallel_tool_calls from string flags", () => {
    const messages = [{ role: "user", content: "hello" }];

    const normalized = normalize({
      body: { messages, parallel_tool_calls: "yes" },
      messages,
    });

    expect(normalized.turn.tools?.parallelToolCalls).toBe(true);
    expect(normalized.message.tools?.parallelToolCalls).toBe(true);
  });

  it("rejects invalid tool definitions", () => {
    const messages = [{ role: "user", content: "hello" }];
    const err = catchNormalization({
      body: { messages, tools: [{ type: "function" }] },
      messages,
    });

    expect(err).toBeInstanceOf(ChatJsonRpcNormalizationError);
    expect(err?.body?.error?.param).toBe("tools[0].function.name");
  });

  it("rejects tool_choice when tool definitions are missing", () => {
    const messages = [{ role: "user", content: "hello" }];
    const err = catchNormalization({
      body: { messages, tool_choice: { function: { name: "do_it" } } },
      messages,
    });

    expect(err).toBeInstanceOf(ChatJsonRpcNormalizationError);
    expect(err?.body?.error?.param).toBe("tool_choice");
  });

  it("rejects tool_choice with an unsupported type", () => {
    const messages = [{ role: "user", content: "hello" }];
    const tools = [
      { type: "function", function: { name: "do_it", parameters: { type: "object" } } },
    ];
    const err = catchNormalization({
      body: { messages, tools, tool_choice: { type: "tool", function: { name: "do_it" } } },
      messages,
    });

    expect(err).toBeInstanceOf(ChatJsonRpcNormalizationError);
    expect(err?.body?.error?.param).toBe("tool_choice.type");
  });

  it("accepts tool_choice using fn alias", () => {
    const messages = [{ role: "user", content: "hello" }];
    const tools = [
      { type: "function", function: { name: "do_it", parameters: { type: "object" } } },
    ];

    const normalized = normalize({
      body: { messages, tools, tool_choice: { fn: { name: "do_it" } } },
      messages,
    });

    expect(normalized.turn.tools?.choice).toMatchObject({
      type: "function",
      function: { name: "do_it" },
    });
  });

  it("rejects legacy functions without a name", () => {
    const messages = [{ role: "user", content: "hello" }];
    const err = catchNormalization({
      body: { messages, functions: [{}] },
      messages,
    });

    expect(err).toBeInstanceOf(ChatJsonRpcNormalizationError);
    expect(err?.body?.error?.param).toBe("functions[0].name");
  });

  it("rejects reasoning payloads that are not objects", () => {
    const messages = [{ role: "user", content: "hello" }];
    const err = catchNormalization({
      body: { messages, reasoning: "low" },
      messages,
    });

    expect(err).toBeInstanceOf(ChatJsonRpcNormalizationError);
    expect(err?.body?.error?.param).toBe("reasoning");
  });

  it("prefers explicit reasoningEffort over reasoning payload effort", () => {
    const messages = [{ role: "user", content: "hello" }];
    const normalized = normalize({
      body: { messages, reasoning: { effort: "low", summary: "short" } },
      messages,
      reasoningEffort: "high",
    });

    expect(normalized.turn.effort).toBe("high");
    expect(normalized.message.reasoning).toMatchObject({ effort: "high", summary: "short" });
  });

  it("normalizes json_schema response_format with schema wrapper", () => {
    const messages = [{ role: "user", content: "hello" }];
    const responseFormat = {
      type: "json_schema",
      schema: { type: "object", properties: { answer: { type: "string" } } },
    };

    const normalized = normalize({
      body: { messages, response_format: responseFormat },
      messages,
    });

    expect(normalized.message.responseFormat?.type).toBe("json_schema");
    expect(normalized.turn.finalOutputJsonSchema).toMatchObject({ type: "object" });
  });

  it("rejects response_format without a type", () => {
    const messages = [{ role: "user", content: "hello" }];
    const err = catchNormalization({
      body: { messages, response_format: {} },
      messages,
    });

    expect(err).toBeInstanceOf(ChatJsonRpcNormalizationError);
    expect(err?.body?.error?.param).toBe("response_format.type");
  });

  it("flattens image_url and input_text content parts", () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: "hello " },
          { type: "image_url", image_url: { url: "https://example.com/img.png" } },
          { type: "input_text", input_text: "done" },
        ],
      },
    ];

    const normalized = normalize({ body: { messages }, messages });
    const prompt = normalized.turn.items[0]?.data?.text || "";
    expect(prompt).toContain("hello ");
    expect(prompt).toContain("[image:https://example.com/img.png]");
    expect(prompt).toContain("done");
  });

  it("adds role labels when multiple user messages are present", () => {
    const messages = [
      { role: "user", content: "first" },
      { role: "user", content: "second" },
    ];

    const normalized = normalize({ body: { messages }, messages });
    const prompt = normalized.turn.items[0]?.data?.text || "";
    expect(prompt).toContain("[user] first");
    expect(prompt).toContain("[user] second");
  });

  it("rejects unsupported message roles", () => {
    const messages = [{ role: "custom", content: "hello" }];
    const err = catchNormalization({
      body: { messages },
      messages,
    });

    expect(err).toBeInstanceOf(ChatJsonRpcNormalizationError);
    expect(err?.body?.error?.param).toBe("messages[0].role");
  });
});
