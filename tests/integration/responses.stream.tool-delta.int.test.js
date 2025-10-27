import { beforeAll, afterAll, test, expect } from "vitest";
import { startServer, stopServer } from "./helpers.js";
import { parseSSE } from "../shared/transcript-utils.js";

let serverCtx;

beforeAll(async () => {
  serverCtx = await startServer({
    CODEX_BIN: "scripts/fake-codex-proto.js",
    FAKE_CODEX_MODE: "tool_call",
    FAKE_CODEX_PARALLEL: "true",
    PROXY_SSE_KEEPALIVE_MS: "0",
  });
}, 10_000);

afterAll(async () => {
  if (serverCtx) await stopServer(serverCtx.child);
});

const getCompletedEnvelope = (entries) =>
  entries.find((entry) => entry?.type === "data" && entry.event === "response.completed")?.data
    ?.response || null;

test("aggregates streaming tool-call fragments into final response", async () => {
  const res = await fetch(`http://127.0.0.1:${serverCtx.PORT}/v1/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-sk-ci",
    },
    body: JSON.stringify({
      model: "codex-5",
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: "user", content: "call tool" }],
    }),
  });

  expect(res.ok).toBeTruthy();
  const raw = await res.text();
  const entries = parseSSE(raw);

  // Ensure the adapter emitted the canonical typed events in order
  const eventNames = entries
    .filter((entry) => entry?.type === "data" && entry.event)
    .map((entry) => entry.event);
  expect(eventNames[0]).toBe("response.created");
  expect(eventNames).toContain("response.completed");

  const completed = getCompletedEnvelope(entries);
  expect(completed).not.toBeNull();
  expect(completed.status).toBe("completed");
  expect(completed.model).toBe("codex-5");

  const output = Array.isArray(completed.output) ? completed.output : [];
  expect(output).toHaveLength(1);
  const message = output[0];
  expect(message.role).toBe("assistant");
  expect(Array.isArray(message.content)).toBe(true);
  const content = message.content.filter(Boolean);

  // Streaming tool call should aggregate into a tool_use node with full arguments.
  expect(content.some((node) => node.type === "tool_use")).toBe(true);
  const toolNode = content.find((node) => node.type === "tool_use");
  expect(toolNode.name).toBe("lookup_user");
  expect(toolNode.tool_type).toBe("function");
  expect(toolNode.input).toEqual({ id: "42" });

  // No output_text nodes since Codex only produced tool deltas.
  expect(content.every((node) => node.type !== "output_text" || node.text === "")).toBe(true);

  // Usage should be included when stream_options.include_usage=true.
  expect(completed.usage).toMatchObject({
    input_tokens: expect.any(Number),
    output_tokens: expect.any(Number),
    total_tokens: expect.any(Number),
  });
});

test("omits usage when stream_options.include_usage is not requested", async () => {
  const res = await fetch(`http://127.0.0.1:${serverCtx.PORT}/v1/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-sk-ci",
    },
    body: JSON.stringify({
      model: "codex-5",
      stream: true,
      messages: [{ role: "user", content: "no usage" }],
    }),
  });

  expect(res.ok).toBeTruthy();
  const raw = await res.text();
  const entries = parseSSE(raw);
  const completed = getCompletedEnvelope(entries);
  expect(completed).not.toBeNull();
  expect(completed.usage).toBeUndefined();
});
