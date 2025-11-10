import { beforeAll, afterAll, describe, test, expect } from "vitest";
import fetch from "node-fetch";
import { startServer, stopServer } from "./helpers.js";
import { parseSSE } from "../shared/transcript-utils.js";

describe("chat multi-choice tool-call parity", () => {
  let serverCtx;

  beforeAll(async () => {
    serverCtx = await startServer({
      FAKE_CODEX_MODE: "multi_choice_tool_call",
      FAKE_CODEX_CHOICE_COUNT: "2",
    });
  }, 10_000);

  afterAll(async () => {
    if (serverCtx) await stopServer(serverCtx.child);
  });

  test("streaming isolates tool state per choice", async () => {
    const res = await fetch(`http://127.0.0.1:${serverCtx.PORT}/v1/chat/completions?stream=true`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-sk-ci",
      },
      body: JSON.stringify({
        model: "codex-5",
        stream: true,
        n: 2,
        messages: [{ role: "user", content: "multi choice tools" }],
      }),
    });

    expect(res.ok).toBe(true);
    const raw = await res.text();
    const entries = parseSSE(raw);
    const dataEntries = entries.filter((entry) => entry.type === "data");

    const toolCallDeltas = [];
    const textDeltas = [];
    for (const entry of dataEntries) {
      const choices = Array.isArray(entry.data?.choices) ? entry.data.choices : [];
      for (const choice of choices) {
        if (choice?.delta?.tool_calls) toolCallDeltas.push(choice);
        if (choice?.delta?.content) textDeltas.push(choice);
      }
    }

    expect(toolCallDeltas.length).toBeGreaterThan(0);
    expect(toolCallDeltas.every((choice) => choice.index === 0)).toBe(true);
    expect(
      textDeltas.some((choice) => choice.index === 1 && /Choice 1/i.test(choice.delta.content))
    ).toBe(true);

    const finishChunk = dataEntries.find((entry) =>
      entry.data?.choices?.some((choice) => choice.finish_reason !== null)
    );
    expect(finishChunk).toBeTruthy();
    const finishMap = new Map();
    for (const choice of finishChunk.data.choices) {
      if (choice.finish_reason !== null) finishMap.set(choice.index, choice.finish_reason);
    }
    expect(finishMap.get(0)).toBe("tool_calls");
    expect(finishMap.get(1)).toBe("stop");

    expect(entries.some((entry) => entry.type === "done")).toBe(true);
  });

  test("non-stream responses keep per-choice envelopes", async () => {
    const res = await fetch(`http://127.0.0.1:${serverCtx.PORT}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-sk-ci",
      },
      body: JSON.stringify({
        model: "codex-5",
        n: 2,
        messages: [{ role: "user", content: "multi choice tools" }],
      }),
    });

    expect(res.ok).toBe(true);
    const payload = await res.json();
    expect(Array.isArray(payload.choices)).toBe(true);
    expect(payload.choices).toHaveLength(2);

    const [first, second] = payload.choices;
    expect(first.message.tool_calls).toBeTruthy();
    expect(first.message.content).toMatch(/<use_tool>/);
    expect(first.finish_reason).toBe("tool_calls");

    expect(second.message.tool_calls).toBeFalsy();
    expect(second.message.content).toMatch(/Choice 1/i);
    expect(second.finish_reason).toBe("stop");
  });

  test("non-stream responses isolate when only choice 1 performs a tool call", async () => {
    const isolatedCtx = await startServer({
      FAKE_CODEX_MODE: "multi_choice_tool_call",
      FAKE_CODEX_CHOICE_COUNT: "2",
      FAKE_CODEX_TOOL_CALL_CHOICES: "1",
    });
    const requestPayload = {
      model: "codex-5",
      n: 2,
      messages: [{ role: "user", content: "multi choice tools" }],
    };
    const runRequest = async (headers = {}) => {
      const res = await fetch(`http://127.0.0.1:${isolatedCtx.PORT}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-sk-ci",
          ...headers,
        },
        body: JSON.stringify(requestPayload),
      });
      expect(res.ok).toBe(true);
      return res.json();
    };

    try {
      const obsidianPayload = await runRequest();
      expect(obsidianPayload.choices).toHaveLength(2);
      const [choiceZero, choiceOne] = obsidianPayload.choices;
      expect(choiceZero.message.tool_calls).toBeFalsy();
      expect(choiceZero.message.content).toMatch(/Choice 0/i);
      expect(choiceZero.finish_reason).toBe("stop");

      expect(choiceOne.message.tool_calls).toBeTruthy();
      expect(choiceOne.message.content).toMatch(/<use_tool>/);
      expect(choiceOne.finish_reason).toBe("tool_calls");

      const openAiJsonPayload = await runRequest({ "x-proxy-output-mode": "openai-json" });
      expect(openAiJsonPayload.choices).toHaveLength(2);
      const [jsonChoiceZero, jsonChoiceOne] = openAiJsonPayload.choices;
      expect(jsonChoiceZero.message.tool_calls).toBeFalsy();
      expect(jsonChoiceZero.message.content).toMatch(/Choice 0/i);
      expect(jsonChoiceZero.finish_reason).toBe("stop");

      expect(jsonChoiceOne.message.content).toBeNull();
      expect(Array.isArray(jsonChoiceOne.message.tool_calls)).toBe(true);
      expect(jsonChoiceOne.message.tool_calls).toHaveLength(1);
      expect(jsonChoiceOne.finish_reason).toBe("tool_calls");
    } finally {
      await stopServer(isolatedCtx.child);
    }
  });
});
