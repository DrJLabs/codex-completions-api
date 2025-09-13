// @ts-check
import { test, expect } from "@playwright/test";
import { readSSE } from "./lib/sse-reader.js";

test("when include_usage is absent, no usage chunk is emitted", async ({ baseURL }) => {
  const url = new URL("v1/chat/completions", baseURL).toString();
  const frames = await readSSE(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer test-sk-ci` },
    body: JSON.stringify({
      model: "codex-5",
      stream: true,
      messages: [{ role: "user", content: "Short reply" }],
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

  // No object-typed usage should appear
  const usageObjIdx = objs.findIndex(
    (o) => o && o.usage && typeof o.usage === "object" && o.usage !== null
  );
  expect(usageObjIdx).toBe(-1);

  // Final JSON before [DONE] must be finish_reason chunk
  const lastObj = objs.at(-1);
  const lastChoices = Array.isArray(lastObj?.choices) ? lastObj.choices : [];
  const lastChoice = lastChoices.at(0);
  expect(lastChoice && typeof lastChoice.finish_reason === "string").toBe(true);
});
