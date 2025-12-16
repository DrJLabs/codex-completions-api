import { describe, expect, it } from "vitest";
import {
  ChatJsonRpcNormalizationError,
  normalizeChatJsonRpcRequest,
} from "../../src/handlers/chat/request.js";

const EFFECTIVE_MODEL = "gpt-5";

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
});
