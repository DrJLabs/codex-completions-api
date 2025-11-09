import { beforeAll, afterAll, describe, expect, test } from "vitest";
import fetch from "node-fetch";
import { startServer, stopServer } from "./helpers.js";
import { parseSSE } from "../shared/transcript-utils.js";

const buildRequestPayload = () => ({
  model: "codex-5",
  stream: true,
  messages: [{ role: "user", content: "invoke lookup_user" }],
});

const flattenChoiceEntries = (entries) =>
  entries.map((entry, index) => ({
    index,
    choices: Array.isArray(entry?.data?.choices) ? entry.data.choices : [],
  }));

describe("chat streaming tool-call contract", () => {
  let serverCtx;

  beforeAll(async () => {
    serverCtx = await startServer({
      CODEX_BIN: "scripts/fake-codex-proto.js",
      FAKE_CODEX_MODE: "tool_call",
      PROXY_SSE_KEEPALIVE_MS: "0",
    });
  }, 10_000);

  afterAll(async () => {
    if (serverCtx) await stopServer(serverCtx.child);
  });

  test("emits role-first chunk, single <use_tool> delta, and canonical finish frame", async () => {
    const response = await fetch(
      `http://127.0.0.1:${serverCtx.PORT}/v1/chat/completions?stream=true`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-sk-ci",
        },
        body: JSON.stringify(buildRequestPayload()),
      }
    );

    expect(response.ok).toBe(true);
    const raw = await response.text();
    const entries = parseSSE(raw);
    const dataEntries = entries.filter((entry) => entry?.type === "data");
    expect(dataEntries.length).toBeGreaterThan(0);
    expect(entries.some((entry) => entry?.type === "done")).toBe(true);

    const flattened = flattenChoiceEntries(dataEntries);

    const roleChunks = flattened.filter((chunk) =>
      chunk.choices.some((choice) => choice?.delta?.role === "assistant")
    );
    expect(roleChunks).toHaveLength(1);
    const roleChunkIndex = roleChunks[0].index;

    const toolCallMetaChunks = flattened.filter((chunk) =>
      chunk.choices.some(
        (choice) => Array.isArray(choice?.delta?.tool_calls) && choice.delta.tool_calls.length > 0
      )
    );
    expect(toolCallMetaChunks.length).toBeGreaterThan(0);
    expect(roleChunkIndex).toBeLessThan(toolCallMetaChunks[0].index);

    const argumentChunks = [];
    for (const chunk of toolCallMetaChunks) {
      for (const choice of chunk.choices) {
        const toolCalls = Array.isArray(choice?.delta?.tool_calls) ? choice.delta.tool_calls : [];
        for (const toolCall of toolCalls) {
          const value = toolCall?.function?.arguments;
          if (typeof value === "string" && value.length) {
            argumentChunks.push({ index: chunk.index, value });
          }
        }
      }
    }

    expect(argumentChunks.length).toBeGreaterThan(0);
    argumentChunks.forEach((chunk, idx) => {
      if (idx === 0) return;
      expect(chunk.value.startsWith(argumentChunks[idx - 1].value)).toBe(true);
    });
    const finalArgs = argumentChunks.at(-1)?.value ?? "";
    expect(() => JSON.parse(finalArgs)).not.toThrow();
    expect(JSON.parse(finalArgs)).toEqual({ id: "42" });

    const contentChunks = flattened
      .map((chunk) => ({
        index: chunk.index,
        content: chunk.choices
          .map((choice) => choice?.delta?.content)
          .find((segment) => typeof segment === "string" && segment.length),
      }))
      .filter((entry) => typeof entry.content === "string");

    expect(contentChunks).toHaveLength(1);
    const [{ index: contentIndex, content }] = contentChunks;
    expect(content).toMatch(/<use_tool>[\s\S]*<\/use_tool>/);
    expect(content.trim().endsWith("</use_tool>")).toBe(true);
    expect(content).not.toMatch(/Hello from fake-codex/i);
    expect(contentIndex).toBeGreaterThan(argumentChunks.at(-1).index);

    const finishEvents = [];
    for (const chunk of flattened) {
      for (const choice of chunk.choices) {
        if (choice.finish_reason) {
          finishEvents.push({ index: chunk.index, reason: choice.finish_reason });
        }
      }
    }
    expect(finishEvents).toHaveLength(1);
    const [{ index: finishIndex, reason: finishReason }] = finishEvents;
    expect(finishReason).toBe("tool_calls");
    expect(finishIndex).toBeGreaterThan(contentIndex);

    const postFinishContent = flattened
      .filter((chunk) => chunk.index > finishIndex)
      .some((chunk) =>
        chunk.choices.some(
          (choice) => typeof choice?.delta?.content === "string" && choice.delta.content.length
        )
      );
    expect(postFinishContent).toBe(false);
  });
});

describe("chat streaming tool-call UTF-8 safety", () => {
  let serverCtx;

  beforeAll(async () => {
    serverCtx = await startServer({
      CODEX_BIN: "scripts/fake-codex-proto.js",
      FAKE_CODEX_MODE: "tool_call",
      FAKE_CODEX_TOOL_ARGUMENT: '{"payload":"👩‍💻漢字"}',
      FAKE_CODEX_TOOL_ARGUMENT_CHUNK_SIZE: "3",
      PROXY_SSE_KEEPALIVE_MS: "0",
    });
  }, 10_000);

  afterAll(async () => {
    if (serverCtx) await stopServer(serverCtx.child);
  });

  test("emits cumulative multibyte argument deltas", async () => {
    const response = await fetch(
      `http://127.0.0.1:${serverCtx.PORT}/v1/chat/completions?stream=true`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-sk-ci",
        },
        body: JSON.stringify(buildRequestPayload()),
      }
    );

    expect(response.ok).toBe(true);
    const raw = await response.text();
    const entries = parseSSE(raw).filter((entry) => entry?.type === "data");
    const argumentChunks = [];
    for (const entry of entries) {
      const choice = entry?.data?.choices?.[0];
      const toolCalls = choice?.delta?.tool_calls;
      if (Array.isArray(toolCalls) && toolCalls.length) {
        const value = toolCalls[0]?.function?.arguments;
        if (typeof value === "string" && value.length) {
          argumentChunks.push(value);
        }
      }
    }

    expect(argumentChunks.length).toBeGreaterThan(0);
    argumentChunks.forEach((chunk, idx, list) => {
      if (idx === 0) return;
      expect(chunk.startsWith(list[idx - 1])).toBe(true);
    });
    const finalArgs = argumentChunks.at(-1);
    expect(finalArgs).toBe('{"payload":"👩‍💻漢字"}');
    expect(() => JSON.parse(finalArgs)).not.toThrow();
  });
});
