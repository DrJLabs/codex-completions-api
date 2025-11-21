import fetch from "node-fetch";
import { afterAll, describe, expect, test } from "vitest";
import { parseSSE, sanitizeStreamTranscript } from "../shared/transcript-utils.js";
import { startServer, stopServer } from "./helpers.js";

const STREAM_ENDPOINT = (port) => `http://127.0.0.1:${port}/v1/chat/completions?stream=true`;
const NONSTREAM_ENDPOINT = (port) => `http://127.0.0.1:${port}/v1/chat/completions`;

const BASE_REQUEST = {
  model: "codex-5",
  messages: [{ role: "user", content: "Stream tool execution" }],
  tools: [
    {
      type: "function",
      function: {
        name: "lookup_user",
        description: "Returns fake profile information",
        parameters: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
  ],
  tool_choice: { type: "function", function: { name: "lookup_user" } },
};

describe("chat streaming tool-call coverage gaps", () => {
  let serverCtx;
  const startFresh = async (env) => {
    if (serverCtx) await stopServer(serverCtx.child);
    serverCtx = await startServer(env);
    return serverCtx;
  };

  afterAll(async () => {
    if (serverCtx) await stopServer(serverCtx.child);
  });

  test("ignores heartbeat comments and preserves single finish", async () => {
    await startFresh({
      CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
      FAKE_CODEX_MODE: "tool_call",
      PROXY_SSE_KEEPALIVE_MS: "10",
      PROXY_PROTECT_MODELS: "false",
    });

    const res = await fetch(STREAM_ENDPOINT(serverCtx.PORT), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-sk-ci",
      },
      body: JSON.stringify({ ...BASE_REQUEST, stream: true }),
    });
    expect(res.ok).toBe(true);
    const raw = await res.text();
    const entries = parseSSE(raw);
    const comments = entries.filter((entry) => entry?.type === "comment");
    expect(comments.length).toBeGreaterThan(0);
    const dataEntries = entries.filter((entry) => entry?.type === "data");
    expect(dataEntries.length).toBeGreaterThan(0);
    const finish = dataEntries
      .flatMap((entry, idx) =>
        (entry.data?.choices || []).map((choice) => ({ idx, finish: choice.finish_reason }))
      )
      .filter((c) => c.finish);
    expect(finish).toHaveLength(1);
    const finishIdx = finish[0].idx;
    const postFinishContent = dataEntries
      .slice(finishIdx + 1)
      .some((entry) =>
        (entry.data?.choices || []).some(
          (choice) =>
            typeof choice?.delta?.content === "string" ||
            (Array.isArray(choice?.delta?.tool_calls) && choice.delta.tool_calls.length > 0)
        )
      );
    expect(postFinishContent).toBe(false);
  }, 20_000);

  test("finish_reason prefers tool_calls even when length requested", async () => {
    await startFresh({
      CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
      FAKE_CODEX_MODE: "tool_call",
      FAKE_CODEX_FINISH_REASON: "length",
      PROXY_PROTECT_MODELS: "false",
    });
    const res = await fetch(STREAM_ENDPOINT(serverCtx.PORT), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-sk-ci",
      },
      body: JSON.stringify({ ...BASE_REQUEST, stream: true }),
    });
    expect(res.ok).toBe(true);
    const entries = parseSSE(await res.text()).filter((e) => e?.type === "data");
    const finish = entries
      .flatMap((entry) => entry.data?.choices || [])
      .map((choice) => choice.finish_reason)
      .filter(Boolean);
    expect(finish).toContain("tool_calls");
  }, 15_000);

  test("error before first tool-call surfaces HTTP failure", async () => {
    await startFresh({
      CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
      FAKE_CODEX_MODE: "error",
      PROXY_PROTECT_MODELS: "false",
    });
    const res = await fetch(NONSTREAM_ENDPOINT(serverCtx.PORT), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-sk-ci",
      },
      body: JSON.stringify({ ...BASE_REQUEST, stream: false }),
    });
    expect(res.ok).toBe(false);
  }, 10_000);

  test("error after first tool-call still emits canonical finish and [DONE]", async () => {
    await startFresh({
      CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
      FAKE_CODEX_MODE: "tool_call",
      FAKE_CODEX_ERROR_AFTER_FIRST_TOOL: "true",
      FAKE_CODEX_WORKER_AUTOEXIT_MS: "1000",
      PROXY_TIMEOUT_MS: "4000",
      PROXY_PROTECT_MODELS: "false",
    });
    const res = await fetch(STREAM_ENDPOINT(serverCtx.PORT), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-sk-ci",
      },
      body: JSON.stringify({ ...BASE_REQUEST, stream: true }),
    });
    expect(res.ok).toBe(true);
    const entries = parseSSE(await res.text());
    const dataEntries = entries.filter((e) => e?.type === "data");
    const finish = dataEntries
      .flatMap((entry) => entry.data?.choices || [])
      .map((choice) => choice.finish_reason)
      .filter(Boolean);
    if (finish.length > 0) {
      expect(finish).toContain("tool_calls");
    }
    const doneFrames = entries.filter((e) => e?.type === "done");
    expect(doneFrames.length).toBe(1);
  }, 15_000);

  test("multi-choice tool calls stay isolated per choice", async () => {
    await startFresh({
      CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
      FAKE_CODEX_MODE: "multi_choice_tool",
      PROXY_PROTECT_MODELS: "false",
    });
    const res = await fetch(STREAM_ENDPOINT(serverCtx.PORT), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-sk-ci",
      },
      body: JSON.stringify({ ...BASE_REQUEST, stream: true }),
    });
    expect(res.ok).toBe(true);
    const entries = parseSSE(await res.text()).filter((e) => e?.type === "data");
    const choicesSeen = new Set();
    const toolIdsByChoice = new Map();
    entries.forEach((entry) => {
      (entry.data?.choices || []).forEach((choice) => {
        const idx = choice.index ?? 0;
        choicesSeen.add(idx);
        const calls = Array.isArray(choice?.delta?.tool_calls)
          ? choice.delta.tool_calls
          : choice.message?.tool_calls || [];
        calls.forEach((call) => {
          const bucket = toolIdsByChoice.get(idx) || new Set();
          if (call?.id) bucket.add(call.id);
          toolIdsByChoice.set(idx, bucket);
        });
      });
    });
    expect(choicesSeen.size).toBeGreaterThanOrEqual(2);
    expect(Array.from(toolIdsByChoice.values()).every((set) => set.size >= 1)).toBe(true);
  }, 15_000);

  test("parallel tool calls emit multiple tool ids when configured", async () => {
    await startFresh({
      CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
      FAKE_CODEX_MODE: "tool_call",
      FAKE_CODEX_PARALLEL: "true",
      FAKE_CODEX_TOOL_CALL_COUNT: "2",
      PROXY_PROTECT_MODELS: "false",
    });
    const res = await fetch(STREAM_ENDPOINT(serverCtx.PORT), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-sk-ci",
      },
      body: JSON.stringify({ ...BASE_REQUEST, stream: true }),
    });
    expect(res.ok).toBe(true);
    const entries = parseSSE(await res.text()).filter((e) => e?.type === "data");
    const ids = new Set();
    entries.forEach((entry) =>
      (entry.data?.choices || []).forEach((choice) => {
        const calls = Array.isArray(choice?.delta?.tool_calls)
          ? choice.delta.tool_calls
          : choice.message?.tool_calls || [];
        calls.forEach((call) => call?.id && ids.add(call.id));
      })
    );
    expect(ids.size).toBeGreaterThanOrEqual(2);
  }, 15_000);

  test("function_call then tool_calls migration prefers tool_calls in final envelope", async () => {
    await startFresh({
      CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
      FAKE_CODEX_MODE: "function_then_tool",
      PROXY_PROTECT_MODELS: "false",
    });
    const res = await fetch(NONSTREAM_ENDPOINT(serverCtx.PORT), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-sk-ci",
      },
      body: JSON.stringify(BASE_REQUEST),
    });
    expect(res.ok).toBe(true);
    const payload = await res.json();
    const choice = payload?.choices?.[0];
    expect(choice?.message?.tool_calls?.length).toBeGreaterThan(0);
    expect(choice?.finish_reason).toBe("tool_calls");
    expect(choice?.message?.content).toBe(null);
  }, 10_000);

  test("stream ↔ non-stream parity for tool_calls snapshot", async () => {
    await startFresh({
      CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
      FAKE_CODEX_MODE: "tool_call",
      PROXY_PROTECT_MODELS: "false",
    });
    const streamRes = await fetch(STREAM_ENDPOINT(serverCtx.PORT), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-sk-ci",
      },
      body: JSON.stringify({ ...BASE_REQUEST, stream: true }),
    });
    const nonStreamRes = await fetch(NONSTREAM_ENDPOINT(serverCtx.PORT), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-sk-ci",
      },
      body: JSON.stringify(BASE_REQUEST),
    });
    expect(streamRes.ok).toBe(true);
    expect(nonStreamRes.ok).toBe(true);
    const streamEntries = sanitizeStreamTranscript(parseSSE(await streamRes.text()));
    const nonStream = await nonStreamRes.json();
    const streamToolCalls = [];
    streamEntries
      .filter((e) => e?.type === "data")
      .forEach((entry) =>
        (entry.data?.choices || []).forEach((choice) => {
          const calls = Array.isArray(choice?.delta?.tool_calls)
            ? choice.delta.tool_calls
            : choice.message?.tool_calls || [];
          calls.forEach((call) => {
            const args = call?.function?.arguments || call?.function_call?.arguments;
            streamToolCalls.push({ name: call?.function?.name, args });
          });
        })
      );
    const finalToolCalls = Array.isArray(nonStream?.choices?.[0]?.message?.tool_calls)
      ? nonStream.choices[0].message.tool_calls
      : [];
    expect(finalToolCalls.length).toBeGreaterThan(0);
    expect(streamToolCalls.length).toBeGreaterThan(0);
    expect(
      finalToolCalls.every((call) =>
        streamToolCalls.some((s) => s.name === call.function?.name && s.args?.length > 0)
      )
    ).toBe(true);
  }, 20_000);
});
