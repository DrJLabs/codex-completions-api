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

test("non-stream usage does not include latency placeholder keys", async () => {
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
  const u = j?.usage || {};
  expect(u).toBeTruthy();
  expect(u.prompt_tokens).toBeTypeOf("number");
  expect(u.completion_tokens).toBeTypeOf("number");
  expect(u.total_tokens).toBeTypeOf("number");
  expect(Object.prototype.hasOwnProperty.call(u, "time_to_first_token")).toBe(false);
  expect(Object.prototype.hasOwnProperty.call(u, "throughput_after_first_token")).toBe(false);
});
