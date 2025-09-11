// @ts-check
import { test, expect } from "@playwright/test";
import { collectSSE } from "./test-utils.js";

test("legacy completions stream uses a stable id across chunks", async ({ baseURL }) => {
  const url = new URL("v1/completions", baseURL).toString();
  const frames = await collectSSE(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer test-sk-ci` },
    body: JSON.stringify({ model: "codex-5", stream: true, prompt: "Say hi" }),
  });

  const chunks = frames
    .map((d) => {
      try {
        return JSON.parse(d);
      } catch {
        return null;
      }
    })
    .filter((o) => o && o.object === "text_completion.chunk");
  expect(chunks.length).toBeGreaterThanOrEqual(1);
  const uniqueIds = [...new Set(chunks.map((c) => c.id))];
  expect(uniqueIds.length).toBe(1);
  expect(typeof uniqueIds[0]).toBe("string");
});
