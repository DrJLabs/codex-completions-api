import { beforeAll, afterAll, test, expect } from "vitest";
import { startServer, stopServer } from "./helpers.js";

let PORT;
let child;

beforeAll(async () => {
  const ctx = await startServer({ PROXY_IGNORE_CLIENT_SYSTEM_PROMPT: "false" });
  PORT = ctx.PORT;
  child = ctx.child;
}, 10_000);

afterAll(async () => {
  await stopServer(child);
});

test("accepts client system messages without error", async () => {
  const response = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-sk-ci",
    },
    body: JSON.stringify({
      model: "codex-5",
      stream: false,
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello" },
      ],
    }),
  });

  expect(response.ok).toBe(true);
  const data = await response.json();
  expect(data?.object).toBe("chat.completion");
  expect(Array.isArray(data?.choices)).toBe(true);
  expect(data.choices.length).toBeGreaterThan(0);
  expect(data.choices[0]?.message?.role).toBe("assistant");
  expect(typeof data.choices[0]?.message?.content).toBe("string");
});
