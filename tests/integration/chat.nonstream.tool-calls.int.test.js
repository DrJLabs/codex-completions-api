import { afterEach, describe, expect, test } from "vitest";
import fetch from "node-fetch";
import { startServer, stopServer } from "./helpers.js";

describe("chat non-stream tool-call env toggles", () => {
  let serverCtx;

  afterEach(async () => {
    if (serverCtx) {
      await stopServer(serverCtx.child);
      serverCtx = null;
    }
  });

  test("PROXY_OUTPUT_MODE=openai-json emits legacy envelope without header override", async () => {
    serverCtx = await startServer({
      PROXY_OUTPUT_MODE: "openai-json",
      FAKE_CODEX_MODE: "tool_call",
    });

    const response = await fetch(`http://127.0.0.1:${serverCtx.PORT}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-sk-ci",
      },
      body: JSON.stringify({
        model: "codex-5",
        stream: false,
        messages: [{ role: "user", content: "invoke lookup_user" }],
      }),
    });
    expect(response.ok).toBe(true);
    const payload = await response.json();
    const choice = payload?.choices?.[0];
    expect(choice?.message?.content).toBeNull();
    expect(Array.isArray(choice?.message?.tool_calls)).toBe(true);
    expect(choice.message.tool_calls).toHaveLength(1);
    expect(choice.message.tool_calls[0]?.function?.name).toBe("lookup_user");
    expect(choice.finish_reason).toBe("tool_calls");
  });
});
