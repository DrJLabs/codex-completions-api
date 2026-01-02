import { describe, expect, test } from "vitest";
import fetch from "node-fetch";
import { startServer, stopServer } from "./helpers.js";
import { parseSSE } from "../shared/transcript-utils.js";

const requestPayload = {
  model: "codex-5",
  stream: true,
  messages: [{ role: "user", content: "call lookup_user" }],
};

const defaultHeaders = { Authorization: "Bearer test-sk-ci" };

const readToolBufferMetrics = async (port) => {
  const res = await fetch(`http://127.0.0.1:${port}/__test/tool-buffer-metrics`, {
    headers: defaultHeaders,
  });
  expect(res.ok).toBe(true);
  return res.json();
};

const resetToolBufferMetrics = async (port) => {
  await fetch(`http://127.0.0.1:${port}/__test/tool-buffer-metrics/reset`, {
    method: "POST",
    headers: defaultHeaders,
  });
};

describe("chat stream tool buffering", () => {
  test("collapses multi-chunk textual XML into a single SSE frame", async () => {
    const ctx = await startServer({
      CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
      FAKE_CODEX_MODE: "multi_choice_tool_call",
      FAKE_CODEX_CHOICE_COUNT: "1",
      FAKE_CODEX_TOOL_CALL_CHOICES: "0",
      FAKE_CODEX_TOOL_XML_CHUNK_SIZE: "5",
      PROXY_SSE_KEEPALIVE_MS: "0",
      PROXY_SANITIZE_METADATA: "false",
      PROXY_TEST_ENDPOINTS: "true",
    });

    try {
      const response = await fetch(`http://127.0.0.1:${ctx.PORT}/v1/chat/completions?stream=true`, {
        method: "POST",
        headers: {
          Authorization: "Bearer test-sk-ci",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestPayload),
      });
      expect(response.ok).toBe(true);
      const raw = await response.text();
      const entries = parseSSE(raw).filter((entry) => entry?.type === "data");
      const contentChunks = entries
        .map((entry) => entry.data?.choices?.[0]?.delta?.content)
        .filter((segment) => typeof segment === "string");
      expect(contentChunks).toHaveLength(1);
      expect(contentChunks[0]).toContain("<use_tool");
      expect(contentChunks[0].trim().endsWith("</use_tool>")).toBe(true);

      const metrics = await readToolBufferMetrics(ctx.PORT);
      expect(metrics.summary.started.name).toBe("codex_tool_buffer_started_total");
      expect(metrics.summary.flushed.name).toBe("codex_tool_buffer_flushed_total");
      expect(metrics.summary.aborted.name).toBe("codex_tool_buffer_aborted_total");
    } finally {
      await resetToolBufferMetrics(ctx.PORT);
      await stopServer(ctx.child);
    }
  });

  test("avoids malformed tool XML when tag prefixes are split across chunks", async () => {
    const ctx = await startServer({
      CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
      FAKE_CODEX_MODE: "multi_choice_tool_call",
      FAKE_CODEX_CHOICE_COUNT: "1",
      FAKE_CODEX_TOOL_CALL_CHOICES: "0",
      FAKE_CODEX_TOOL_XML_CHUNK_SIZE: "4",
      PROXY_SSE_KEEPALIVE_MS: "0",
      PROXY_SANITIZE_METADATA: "false",
      PROXY_TEST_ENDPOINTS: "true",
    });

    try {
      const response = await fetch(`http://127.0.0.1:${ctx.PORT}/v1/chat/completions?stream=true`, {
        method: "POST",
        headers: {
          Authorization: "Bearer test-sk-ci",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestPayload),
      });
      expect(response.ok).toBe(true);
      const raw = await response.text();
      const entries = parseSSE(raw).filter((entry) => entry?.type === "data");
      const content = entries
        .map((entry) => entry.data?.choices?.[0]?.delta?.content)
        .filter((segment) => typeof segment === "string")
        .join("");

      expect(content).toContain("<use_tool");
      expect(content).toContain("</use_tool>");
      expect(content).not.toContain("</use_tool<use_tool>");
      expect(content).not.toMatch(/<use_tool(?!>)/);
      expect(content).not.toMatch(/<\/use_tool(?!>)/);
    } finally {
      await resetToolBufferMetrics(ctx.PORT);
      await stopServer(ctx.child);
    }
  });

  test("flushes partial buffers when backend disconnects mid-block", async () => {
    const ctx = await startServer({
      CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
      FAKE_CODEX_MODE: "multi_choice_tool_call",
      FAKE_CODEX_CHOICE_COUNT: "1",
      FAKE_CODEX_TOOL_CALL_CHOICES: "0",
      FAKE_CODEX_TOOL_XML_CHUNK_SIZE: "4",
      FAKE_CODEX_TRUNCATE_TOOL_XML: "true",
      FAKE_CODEX_ABORT_AFTER_TOOL_XML: "true",
      PROXY_SSE_KEEPALIVE_MS: "0",
      PROXY_SANITIZE_METADATA: "false",
      PROXY_TEST_ENDPOINTS: "true",
    });

    try {
      const response = await fetch(`http://127.0.0.1:${ctx.PORT}/v1/chat/completions?stream=true`, {
        method: "POST",
        headers: {
          Authorization: "Bearer test-sk-ci",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestPayload),
      });
      expect(response.ok).toBe(true);
      const raw = await response.text();
      const rows = parseSSE(raw).filter((entry) => entry?.type === "data");
      const chunk = rows
        .map((entry) => entry.data?.choices?.[0]?.delta?.content)
        .find((segment) => typeof segment === "string");
      expect(chunk).toBeDefined();
      expect(chunk?.includes("<use_tool")).toBe(true);

      const metrics = await readToolBufferMetrics(ctx.PORT);
      expect(metrics.summary.aborted.name).toBe("codex_tool_buffer_aborted_total");
    } finally {
      await resetToolBufferMetrics(ctx.PORT);
      await stopServer(ctx.child);
    }
  });
});
