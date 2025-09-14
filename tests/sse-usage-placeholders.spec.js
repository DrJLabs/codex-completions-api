/* eslint-disable security/detect-object-injection */
// @ts-check
import { test, expect } from "@playwright/test";
import { readSSE } from "./lib/sse-reader.js";

test("final usage chunk includes latency placeholders as nulls when include_usage=true", async ({
  baseURL,
}) => {
  const url = new URL("v1/chat/completions", baseURL).toString();
  const frames = await readSSE(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer test-sk-ci` },
    body: JSON.stringify({
      model: "codex-5",
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: "user", content: "Say hi." }],
    }),
  });

  // Must end with [DONE]
  expect(frames[frames.length - 1]?.trim()).toBe("[DONE]");

  const objs = frames
    .map((d) => {
      try {
        return JSON.parse(d);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  // Find final usage chunk
  const usageIdx = objs.findIndex(
    (o) =>
      o?.object === "chat.completion.chunk" &&
      Array.isArray(o?.choices) &&
      o.choices.length === 0 &&
      o?.usage &&
      typeof o.usage.prompt_tokens === "number"
  );
  expect(usageIdx).toBeGreaterThanOrEqual(0);

  const usage = objs[usageIdx].usage;
  expect(Object.prototype.hasOwnProperty.call(usage, "time_to_first_token")).toBe(true);
  expect(Object.prototype.hasOwnProperty.call(usage, "throughput_after_first_token")).toBe(true);
  expect(usage.time_to_first_token).toBeNull();
  expect(usage.throughput_after_first_token).toBeNull();
});
