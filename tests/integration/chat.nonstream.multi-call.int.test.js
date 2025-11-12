import { beforeAll, afterAll, describe, expect, test } from "vitest";
import fetch from "node-fetch";
import { startServer, stopServer } from "./helpers.js";
import { buildBurstEnv, buildLegacyCapEnv } from "../support/fixtures/tool-burst.fixture.js";

const REQUEST_BODY = {
  model: "codex-5",
  stream: false,
  messages: [{ role: "user", content: "emit multi tool burst" }],
};

const countToolBlocks = (content = "") => (content.match(/<use_tool>/g) || []).length;

describe("chat non-stream multi-call envelopes", () => {
  describe("obsidian + openai-json outputs", () => {
    const BURST_COUNT = 3;
    let serverCtx;

    beforeAll(async () => {
      serverCtx = await startServer(buildBurstEnv({ burstCount: BURST_COUNT }));
    }, 15_000);

    afterAll(async () => {
      if (serverCtx) await stopServer(serverCtx.child);
    });

    test("obsidian output concatenates all <use_tool> blocks and emits telemetry headers", async () => {
      const response = await fetch(`http://127.0.0.1:${serverCtx.PORT}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-sk-ci",
        },
        body: JSON.stringify(REQUEST_BODY),
      });

      expect(response.ok).toBe(true);
      expect(response.headers.get("x-codex-tool-call-count")).toBe(String(BURST_COUNT));
      expect(response.headers.get("x-codex-tool-call-truncated")).toBe("false");
      expect(response.headers.get("x-codex-stop-after-tools-mode")).toBe("burst");

      const payload = await response.json();
      const [choice] = payload?.choices || [];
      expect(choice?.finish_reason).toBe("tool_calls");
      expect(countToolBlocks(choice?.message?.content || "")).toBe(BURST_COUNT);
      expect(choice?.message?.tool_calls?.length).toBe(BURST_COUNT);
    });

    test("openai-json mode nulls assistant content but retains every tool call", async () => {
      const response = await fetch(`http://127.0.0.1:${serverCtx.PORT}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-sk-ci",
          "x-proxy-output-mode": "openai-json",
        },
        body: JSON.stringify(REQUEST_BODY),
      });

      expect(response.ok).toBe(true);
      const payload = await response.json();
      const [choice] = payload?.choices || [];
      expect(choice?.message?.content).toBeNull();
      expect(choice?.message?.tool_calls?.length).toBe(BURST_COUNT);
      expect(choice?.finish_reason).toBe("tool_calls");
    });
  });

  describe("tool block caps propagate to non-stream responses", () => {
    let serverCtx;

    beforeAll(async () => {
      serverCtx = await startServer(
        buildLegacyCapEnv({
          burstCount: 4,
          blockMax: 1,
          extras: { PROXY_STOP_AFTER_TOOLS: "true" },
        })
      );
    }, 15_000);

    afterAll(async () => {
      if (serverCtx) await stopServer(serverCtx.child);
    });

    test("caps tool_calls[] and reports truncation headers", async () => {
      const response = await fetch(`http://127.0.0.1:${serverCtx.PORT}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-sk-ci",
        },
        body: JSON.stringify(REQUEST_BODY),
      });

      expect(response.ok).toBe(true);
      expect(response.headers.get("x-codex-tool-call-count")).toBe("1");
      expect(response.headers.get("x-codex-tool-call-truncated")).toBe("true");
      expect(response.headers.get("x-codex-stop-after-tools-mode")).toBe("first");

      const payload = await response.json();
      const [choice] = payload?.choices || [];
      expect(choice?.message?.tool_calls?.length).toBe(1);
      expect(choice?.finish_reason).toBe("tool_calls");
    });
  });
});
