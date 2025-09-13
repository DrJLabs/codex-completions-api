import { beforeAll, afterAll, test, expect } from "vitest";
import { startServer, stopServer } from "./helpers.js";

let PORT;
let child;

beforeAll(async () => {
  const ctx = await startServer({ CODEX_BIN: "scripts/fake-codex-proto-no-complete.js" });
  PORT = ctx.PORT;
  child = ctx.child;
}, 10_000);

afterAll(async () => {
  await stopServer(child);
});

test("non-stream finish_reason is 'length' when backend exits without task_complete", async () => {
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
  const ch = j?.choices?.[0];
  expect(ch?.finish_reason).toBe("length");
  // usage should still be present via estimator fallback
  expect(typeof j?.usage?.prompt_tokens).toBe("number");
  expect(typeof j?.usage?.completion_tokens).toBe("number");
  expect(typeof j?.usage?.total_tokens).toBe("number");
});
