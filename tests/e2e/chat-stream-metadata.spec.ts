import { test, expect } from "@playwright/test";
import fetch from "node-fetch";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer, stopServer, wait } from "../integration/helpers.js";
import { parseSSE } from "../shared/transcript-utils.js";

const readLastLogEntry = async (filePath: string) => {
  const data = await fs.readFile(filePath, "utf8");
  const lines = data
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  return JSON.parse(lines[lines.length - 1]);
};

const collectStreamContent = (entries: Array<{ type?: string; data?: any }>) => {
  let content = "";
  for (const entry of entries) {
    if (entry?.type !== "data") continue;
    const choices = entry.data?.choices;
    if (!Array.isArray(choices)) continue;
    for (const choice of choices) {
      const segment = choice?.delta?.content;
      if (typeof segment === "string" && segment) content += segment;
    }
  }
  return content;
};

test.describe("Streaming metadata sanitizer toggle", () => {
  test("redacts metadata when PROXY_SANITIZE_METADATA=true", async () => {
    const tokenLogPath = path.join(
      os.tmpdir(),
      `pw-stream-metadata-enabled-${Date.now()}-usage.ndjson`
    );
    const { PORT, child } = await startServer({
      PROXY_SANITIZE_METADATA: "true",
      FAKE_CODEX_METADATA: "true",
      TOKEN_LOG_PATH: tokenLogPath,
    });

    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions?stream=true`, {
        method: "POST",
        headers: {
          Authorization: "Bearer test-sk-ci",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "codex-5",
          stream: true,
          messages: [{ role: "user", content: "hello" }],
        }),
      });

      expect(response.ok).toBeTruthy();
      const raw = await response.text();
      const entries = parseSSE(raw);
      const content = collectStreamContent(entries);
      expect(content).toContain("Hello from fake-codex.");
      expect(content).not.toContain("rollout_path");
      expect(content).not.toContain("session_id");

      await wait(50);
      const usageEntry = await readLastLogEntry(tokenLogPath);
      expect(usageEntry).not.toBeNull();
      expect(usageEntry.metadata_sanitizer_enabled).toBe(true);
      expect(usageEntry.sanitized_metadata_count).toBeGreaterThanOrEqual(2);
      expect(usageEntry.sanitized_metadata_keys).toContain("rollout_path");
      expect(usageEntry.sanitized_metadata_keys).toContain("session_id");
    } finally {
      await stopServer(child);
    }
  });

  test("preserves metadata when PROXY_SANITIZE_METADATA=false", async () => {
    const tokenLogPath = path.join(
      os.tmpdir(),
      `pw-stream-metadata-disabled-${Date.now()}-usage.ndjson`
    );
    const { PORT, child } = await startServer({
      PROXY_SANITIZE_METADATA: "false",
      FAKE_CODEX_METADATA: "true",
      TOKEN_LOG_PATH: tokenLogPath,
    });

    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions?stream=true`, {
        method: "POST",
        headers: {
          Authorization: "Bearer test-sk-ci",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "codex-5",
          stream: true,
          messages: [{ role: "user", content: "hello" }],
        }),
      });

      expect(response.ok).toBeTruthy();
      const raw = await response.text();
      const entries = parseSSE(raw);
      const content = collectStreamContent(entries);
      expect(content).toContain("rollout_path");
      expect(content).toContain("session_id");

      await wait(50);
      const usageEntry = await readLastLogEntry(tokenLogPath);
      expect(usageEntry).not.toBeNull();
      expect(usageEntry.metadata_sanitizer_enabled).toBe(false);
      expect(usageEntry.sanitized_metadata_count).toBe(0);
      expect(Array.isArray(usageEntry.sanitized_metadata_keys)).toBe(true);
      expect(usageEntry.sanitized_metadata_keys).toHaveLength(0);
    } finally {
      await stopServer(child);
    }
  });
});
