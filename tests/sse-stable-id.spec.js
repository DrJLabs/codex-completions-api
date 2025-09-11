// @ts-check
import { test, expect } from "@playwright/test";
import { collectSSE } from "./test-utils.js";

test("chat stream uses a stable id across chunks", async ({ baseURL }) => {
  const url = new URL("v1/chat/completions", baseURL).toString();
  const frames = await collectSSE(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer test-sk-ci` },
    body: JSON.stringify({
      model: "codex-5",
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: "user", content: "Say something short." }],
    }),
  });

  const chunks = frames
    .map((d) => {
      try {
        return JSON.parse(d);
      } catch {
        return null;
      }
    })
    .filter((o) => o && o.object === "chat.completion.chunk");

  expect(chunks.length).toBeGreaterThanOrEqual(2);
  const uniqueIds = [...new Set(chunks.map((c) => c.id))];
  expect(uniqueIds.length).toBe(1);
  expect(typeof uniqueIds[0]).toBe("string");
});
