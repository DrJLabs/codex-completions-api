// @ts-check
import { test, expect } from "@playwright/test";
import { readSSE } from "./lib/sse-reader.js";

test("created is identical across all streamed chunks", async ({ baseURL }) => {
  const url = new URL("v1/chat/completions", baseURL).toString();
  const frames = await readSSE(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer test-sk-ci` },
    body: JSON.stringify({
      model: "codex-5",
      stream: true,
      messages: [{ role: "user", content: "Hello" }],
    }),
  });
  const objs = frames
    .map((d) => {
      try {
        return JSON.parse(d);
      } catch {
        return null;
      }
    })
    .filter((o) => o && o.object === "chat.completion.chunk");

  expect(objs.length).toBeGreaterThan(0);
  const createdVals = Array.from(new Set(objs.map((o) => o.created)));
  expect(createdVals.length).toBe(1);
  expect(typeof createdVals[0]).toBe("number");
});
