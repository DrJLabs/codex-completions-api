import { test, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import fetch from "node-fetch";
import { startServer, stopServer, wait } from "./helpers.js";

let child;

afterEach(async () => {
  if (child) {
    await stopServer(child);
    child = undefined;
  }
});

const readLastLogEntry = async (filePath) => {
  // The test writes the file earlier in a controlled tmp directory; intentional dynamic path.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const data = await fs.readFile(filePath, "utf8");
  const lines = data
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  return JSON.parse(lines[lines.length - 1]);
};

test("sanitizes metadata when toggle enabled", async () => {
  const tokenLogPath = path.join(os.tmpdir(), `metadata-enabled-${Date.now()}-usage.ndjson`);
  const { PORT, child: proc } = await startServer({
    PROXY_SANITIZE_METADATA: "true",
    FAKE_CODEX_METADATA: "true",
    TOKEN_LOG_PATH: tokenLogPath,
  });
  child = proc;

  const response = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-sk-ci",
    },
    body: JSON.stringify({
      model: "codex-5",
      stream: false,
      messages: [{ role: "user", content: "hello" }],
    }),
  });
  expect(response.ok).toBe(true);
  const body = await response.json();
  const messageContent = body?.choices?.[0]?.message?.content || "";
  expect(messageContent).toContain("Hello from fake-codex");
  expect(messageContent).not.toContain("rollout_path");
  expect(messageContent).not.toContain("session_id");

  await wait(50);
  const usageEntry = await readLastLogEntry(tokenLogPath);
  expect(usageEntry).not.toBeNull();
  expect(usageEntry.metadata_sanitizer_enabled).toBe(true);
  expect(usageEntry.sanitized_metadata_count).toBeGreaterThanOrEqual(2);
  expect(usageEntry.sanitized_metadata_keys).toContain("rollout_path");
  expect(usageEntry.sanitized_metadata_keys).toContain("session_id");
  expect(Array.isArray(usageEntry.sanitized_metadata_sources)).toBe(true);
  expect(usageEntry.sanitized_metadata_sources).toContain("message.metadata");
});

test("retains metadata when toggle disabled", async () => {
  const tokenLogPath = path.join(os.tmpdir(), `metadata-disabled-${Date.now()}-usage.ndjson`);
  const { PORT, child: proc } = await startServer({
    PROXY_SANITIZE_METADATA: "false",
    FAKE_CODEX_METADATA: "true",
    TOKEN_LOG_PATH: tokenLogPath,
  });
  child = proc;

  const response = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-sk-ci",
    },
    body: JSON.stringify({
      model: "codex-5",
      stream: false,
      messages: [{ role: "user", content: "hello" }],
    }),
  });
  expect(response.ok).toBe(true);
  const body = await response.json();
  const messageContent = body?.choices?.[0]?.message?.content || "";
  expect(messageContent).toContain("rollout_path");
  expect(messageContent).toContain("session_id");

  await wait(50);
  const usageEntry = await readLastLogEntry(tokenLogPath);
  expect(usageEntry).not.toBeNull();
  expect(usageEntry.metadata_sanitizer_enabled).toBe(false);
  expect(usageEntry.sanitized_metadata_count).toBe(0);
  expect(Array.isArray(usageEntry.sanitized_metadata_keys)).toBe(true);
  expect(usageEntry.sanitized_metadata_keys).toHaveLength(0);
  expect(Array.isArray(usageEntry.sanitized_metadata_sources)).toBe(true);
  expect(usageEntry.sanitized_metadata_sources).toHaveLength(0);
});
