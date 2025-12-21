import { afterAll, beforeAll, describe, expect, test } from "vitest";
import fetch from "node-fetch";
import { startServer, stopServer } from "./helpers.js";

const APP_SERVER_ENV = {
  CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
  PROXY_USE_APP_SERVER: "true",
  CODEX_WORKER_SUPERVISED: "true",
};

describe("chat completions Copilot output mode", () => {
  let serverCtx;

  beforeAll(async () => {
    serverCtx = await startServer({
      ...APP_SERVER_ENV,
      PROXY_OUTPUT_MODE: "openai-json",
      PROXY_COPILOT_AUTO_DETECT: "true",
    });
  }, 10_000);

  afterAll(async () => {
    if (serverCtx) await stopServer(serverCtx.child);
  });

  test("forces obsidian-xml for high-confidence markers", async () => {
    const res = await fetch(`http://127.0.0.1:${serverCtx.PORT}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-sk-ci",
      },
      body: JSON.stringify({
        model: "codex-5",
        messages: [
          {
            role: "user",
            content: "<recent_conversations>...</recent_conversations>",
          },
        ],
      }),
    });

    expect(res.ok).toBe(true);
    expect(res.headers.get("x-proxy-output-mode")).toBe("obsidian-xml");
  });
});
