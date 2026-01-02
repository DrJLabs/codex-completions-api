import { beforeAll, afterAll, test, expect } from "vitest";
import { startServer, stopServer } from "./helpers.js";

let PORT;
let child;

beforeAll(async () => {
  const ctx = await startServer();
  PORT = ctx.PORT;
  child = ctx.child;
}, 10_000);

afterAll(async () => {
  await stopServer(child);
});

test("non-stream response uses stop finish_reason on normal completion and includes usage", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer test-sk-ci` },
    body: JSON.stringify({
      model: "codex-5",
      stream: false,
      messages: [{ role: "user", content: "hello" }],
    }),
  });
  expect(r.ok).toBeTruthy();
  const j = await r.json();
  expect(j?.object).toBe("chat.completion");
  expect(typeof j?.id).toBe("string");
  expect(typeof j?.created).toBe("number");
  expect(typeof j?.model).toBe("string");
  const ch = j?.choices?.[0];
  expect(ch?.index).toBe(0);
  expect(ch?.message?.role).toBe("assistant");
  expect(typeof ch?.message?.content).toBe("string");
  // Because the shim emits task_complete, finish_reason should be "stop"
  expect(ch?.finish_reason).toBe("stop");
  expect(typeof j?.usage?.prompt_tokens).toBe("number");
  expect(typeof j?.usage?.completion_tokens).toBe("number");
  expect(typeof j?.usage?.total_tokens).toBe("number");
});

test("non-stream returns multiple choices when n>1 with aggregated usage", async () => {
  const choiceCount = 3;
  const r = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer test-sk-ci` },
    body: JSON.stringify({
      model: "codex-5",
      stream: false,
      n: choiceCount,
      messages: [{ role: "user", content: "hello multi" }],
    }),
  });
  expect(r.ok).toBeTruthy();
  const j = await r.json();
  expect(Array.isArray(j?.choices)).toBe(true);
  expect(j.choices).toHaveLength(choiceCount);
  const indexes = j.choices.map((choice) => choice.index);
  expect(new Set(indexes)).toEqual(new Set([0, 1, 2]));
  const contents = j.choices.map((choice) => choice?.message?.content ?? null);
  expect(new Set(contents).size).toBeLessThanOrEqual(choiceCount);
  const usage = j?.usage;
  expect(typeof usage?.prompt_tokens).toBe("number");
  expect(typeof usage?.completion_tokens).toBe("number");
  expect(usage.total_tokens).toBe(usage.prompt_tokens + usage.completion_tokens);
  expect(usage.completion_tokens % choiceCount).toBe(0);
});

test("non-stream canonicalizes tool_calls finish_reason when tool payload is returned", async () => {
  const ctx = await startServer({ FAKE_CODEX_MODE: "tool_call" });
  try {
    const r = await fetch(`http://127.0.0.1:${ctx.PORT}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer test-sk-ci` },
      body: JSON.stringify({
        model: "codex-5",
        stream: false,
        messages: [{ role: "user", content: "Use the lookup tool" }],
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
      }),
    });
    expect(r.ok).toBeTruthy();
    const j = await r.json();
    const ch = j?.choices?.[0];
    expect(ch?.finish_reason).toBe("tool_calls");
    expect(Array.isArray(ch?.message?.tool_calls)).toBe(true);
    expect(ch?.message?.tool_calls?.length).toBeGreaterThan(0);
    expect(ch?.message?.content).toContain("<use_tool>");
  } finally {
    await stopServer(ctx.child);
  }
}, 10_000);

test("non-stream normalizes legacy function_call payloads into tool_calls[]", async () => {
  const ctx = await startServer({ FAKE_CODEX_MODE: "function_call" });
  try {
    const r = await fetch(`http://127.0.0.1:${ctx.PORT}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer test-sk-ci` },
      body: JSON.stringify({
        model: "codex-5",
        stream: false,
        messages: [{ role: "user", content: "Call the legacy function" }],
        tools: [
          {
            type: "function",
            function: {
              name: "legacy_lookup",
              description: "Legacy lookup",
              parameters: {
                type: "object",
                properties: { query: { type: "string" } },
                required: ["query"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "legacy_lookup" } },
      }),
    });
    expect(r.ok).toBeTruthy();
    const j = await r.json();
    const ch = j?.choices?.[0];
    expect(ch?.finish_reason).toBe("tool_calls");
    expect(Array.isArray(ch?.message?.tool_calls)).toBe(true);
    expect(ch?.message?.tool_calls?.length).toBe(1);
    expect(ch?.message?.function_call).toBeUndefined();
    expect(ch?.message?.content).toContain("<use_tool>");
  } finally {
    await stopServer(ctx.child);
  }
}, 10_000);

test("non-stream propagates content_filter finish_reason", async () => {
  const ctx = await startServer({ FAKE_CODEX_MODE: "content_filter" });
  try {
    const r = await fetch(`http://127.0.0.1:${ctx.PORT}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer test-sk-ci` },
      body: JSON.stringify({
        model: "codex-5",
        stream: false,
        messages: [{ role: "user", content: "Return disallowed output" }],
      }),
    });
    expect(r.ok).toBeTruthy();
    const j = await r.json();
    const ch = j?.choices?.[0];
    expect(ch?.finish_reason).toBe("content_filter");
    expect(ch?.message?.content).toBeNull();
  } finally {
    await stopServer(ctx.child);
  }
}, 10_000);
