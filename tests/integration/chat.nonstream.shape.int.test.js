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
  // Because the fake proto emits task_complete, finish_reason should be "stop"
  expect(ch?.finish_reason).toBe("stop");
  expect(typeof j?.usage?.prompt_tokens).toBe("number");
  expect(typeof j?.usage?.completion_tokens).toBe("number");
  expect(typeof j?.usage?.total_tokens).toBe("number");
});
