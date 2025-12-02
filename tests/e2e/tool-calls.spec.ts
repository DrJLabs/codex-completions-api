import { test, expect } from "@playwright/test";
import fetch from "node-fetch";
import { startServer, stopServer } from "../integration/helpers.js";
import { parseSSE } from "../shared/transcript-utils.js";

const streamRequestBody = {
  model: "codex-5",
  stream: true,
  messages: [{ role: "user", content: "call lookup_user" }],
};

const APP_SERVER_ENV = {
  CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
  PROXY_USE_APP_SERVER: "true",
  CODEX_WORKER_SUPERVISED: "true",
};

test.describe("chat tool-call parity", () => {
  test("obsidian streaming emits <use_tool> chunk and canonical finish", async () => {
    const ctx = await startServer({
      ...APP_SERVER_ENV,
      FAKE_CODEX_MODE: "tool_call",
      PROXY_SSE_KEEPALIVE_MS: "0",
      PROXY_SANITIZE_METADATA: "false",
    });

    try {
      const response = await fetch(`http://127.0.0.1:${ctx.PORT}/v1/chat/completions?stream=true`, {
        method: "POST",
        headers: {
          Authorization: "Bearer test-sk-ci",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(streamRequestBody),
      });

      expect(response.ok).toBeTruthy();
      const raw = await response.text();
      const entries = parseSSE(raw);
      expect(entries.some((entry) => entry?.type === "done")).toBe(true);

      const contentEntry = entries.find(
        (entry) =>
          entry?.type === "data" &&
          entry.data?.choices?.some((choice) => typeof choice?.delta?.content === "string")
      );
      expect(contentEntry).toBeTruthy();
      const chunk = contentEntry?.data?.choices?.find((choice) => choice?.delta?.content);
      expect(chunk?.delta?.content).toContain("<use_tool>");
      expect(chunk?.delta?.content?.trim().endsWith("</use_tool>")).toBe(true);

      const finishEntry = entries.find(
        (entry) =>
          entry?.type === "data" &&
          entry.data?.choices?.some((choice) => choice.finish_reason === "tool_calls")
      );
      expect(finishEntry).toBeTruthy();
    } finally {
      await stopServer(ctx.child);
    }
  });

  test("openai-json streaming suppresses XML but streams tool_calls deltas", async () => {
    const ctx = await startServer({
      ...APP_SERVER_ENV,
      FAKE_CODEX_MODE: "tool_call",
      PROXY_SSE_KEEPALIVE_MS: "0",
      PROXY_SANITIZE_METADATA: "false",
    });

    try {
      const response = await fetch(`http://127.0.0.1:${ctx.PORT}/v1/chat/completions?stream=true`, {
        method: "POST",
        headers: {
          Authorization: "Bearer test-sk-ci",
          "Content-Type": "application/json",
          "x-proxy-output-mode": "openai-json",
        },
        body: JSON.stringify(streamRequestBody),
      });

      expect(response.ok).toBeTruthy();
      const raw = await response.text();
      const entries = parseSSE(raw);

      const hasContentChunk = entries.some(
        (entry) =>
          entry?.type === "data" &&
          entry.data?.choices?.some((choice) => typeof choice?.delta?.content === "string")
      );
      expect(hasContentChunk).toBe(false);

      const toolCallDeltaCount = entries.reduce((total, entry) => {
        if (entry?.type !== "data") return total;
        const deltaCount = entry.data?.choices?.reduce((inner, choice) => {
          if (Array.isArray(choice?.delta?.tool_calls)) {
            return inner + choice.delta.tool_calls.length;
          }
          return inner;
        }, 0);
        return total + deltaCount;
      }, 0);
      expect(toolCallDeltaCount).toBeGreaterThan(0);

      const finishEntry = entries.find(
        (entry) =>
          entry?.type === "data" &&
          entry.data?.choices?.some((choice) => choice.finish_reason === "tool_calls")
      );
      expect(finishEntry).toBeTruthy();
    } finally {
      await stopServer(ctx.child);
    }
  });

  test("non-stream textual fallback forwards literal <use_tool> block", async () => {
    const ctx = await startServer({
      ...APP_SERVER_ENV,
      FAKE_CODEX_MODE: "multi_choice_tool_call",
      FAKE_CODEX_CHOICE_COUNT: "1",
      FAKE_CODEX_TOOL_CALL_CHOICES: "0",
    });

    try {
      const response = await fetch(`http://127.0.0.1:${ctx.PORT}/v1/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: "Bearer test-sk-ci",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "codex-5",
          messages: [{ role: "user", content: "multi choice tool" }],
        }),
      });

      expect(response.ok).toBeTruthy();
      const payload = await response.json();
      expect(Array.isArray(payload.choices)).toBe(true);
      expect(payload.choices).toHaveLength(1);
      const choice = payload.choices[0];
      expect(choice.message.content).toContain("<use_tool>");
      expect(choice.message.content.trim().endsWith("</use_tool>")).toBe(true);
      expect(choice.finish_reason).toBe("tool_calls");
    } finally {
      await stopServer(ctx.child);
    }
  });

  test("obsidian streaming emits a single chunk even when XML arrives fragmented", async () => {
    const ctx = await startServer({
      ...APP_SERVER_ENV,
      FAKE_CODEX_MODE: "multi_choice_tool_call",
      FAKE_CODEX_CHOICE_COUNT: "1",
      FAKE_CODEX_TOOL_CALL_CHOICES: "0",
      FAKE_CODEX_TOOL_XML_CHUNK_SIZE: "6",
      PROXY_SSE_KEEPALIVE_MS: "0",
    });

    try {
      const response = await fetch(`http://127.0.0.1:${ctx.PORT}/v1/chat/completions?stream=true`, {
        method: "POST",
        headers: {
          Authorization: "Bearer test-sk-ci",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(streamRequestBody),
      });

      expect(response.ok).toBeTruthy();
      const raw = await response.text();
      const entries = parseSSE(raw).filter((entry) => entry?.type === "data");
      const chunks = entries
        .map((entry) => entry.data?.choices?.[0]?.delta?.content)
        .filter((segment) => typeof segment === "string");
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toContain("<use_tool>");
      expect(chunks[0].trim().endsWith("</use_tool>")).toBe(true);
    } finally {
      await stopServer(ctx.child);
    }
  });

  test("obsidian streaming flushes partial buffers when backend disconnects mid-block", async () => {
    const ctx = await startServer({
      ...APP_SERVER_ENV,
      FAKE_CODEX_MODE: "multi_choice_tool_call",
      FAKE_CODEX_CHOICE_COUNT: "1",
      FAKE_CODEX_TOOL_CALL_CHOICES: "0",
      FAKE_CODEX_TOOL_XML_CHUNK_SIZE: "4",
      FAKE_CODEX_TRUNCATE_TOOL_XML: "true",
      FAKE_CODEX_ABORT_AFTER_TOOL_XML: "true",
      PROXY_SSE_KEEPALIVE_MS: "0",
    });

    try {
      const response = await fetch(`http://127.0.0.1:${ctx.PORT}/v1/chat/completions?stream=true`, {
        method: "POST",
        headers: {
          Authorization: "Bearer test-sk-ci",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(streamRequestBody),
      });

      expect(response.ok).toBeTruthy();
      const raw = await response.text();
      const entries = parseSSE(raw).filter((entry) => entry?.type === "data");
      const chunk = entries
        .map((entry) => entry.data?.choices?.[0]?.delta?.content)
        .find((segment) => typeof segment === "string");
      expect(chunk).toBeDefined();
      expect(chunk?.includes("<use_tool")).toBe(true);
    } finally {
      await stopServer(ctx.child);
    }
  });
});
