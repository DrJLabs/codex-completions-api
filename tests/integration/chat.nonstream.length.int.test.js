import { beforeAll, afterAll, test, expect } from "vitest";
import { startServer, stopServer, wait } from "./helpers.js";

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

test("non-stream finish_reason is 'stop' when backend exits without task_complete", async () => {
  async function postOnce() {
    return fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer test-sk-ci` },
      body: JSON.stringify({
        model: "codex-5",
        stream: false,
        messages: [{ role: "user", content: "hello" }],
      }),
    });
  }

  for (let i = 0; i < 5; i += 1) {
    let response;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        response = await postOnce();
        break;
      } catch (err) {
        if (attempt === 1) throw err;
        await wait(100);
      }
    }

    expect(response.ok).toBeTruthy();
    const payload = await response.json();
    expect(payload?.object).toBe("chat.completion");
    const choice = payload?.choices?.[0];
    expect(choice?.finish_reason).toBe("stop");
    expect(typeof payload?.usage?.prompt_tokens).toBe("number");
    expect(typeof payload?.usage?.completion_tokens).toBe("number");
    expect(typeof payload?.usage?.total_tokens).toBe("number");

    if (i < 4) await wait(50);
  }
});
