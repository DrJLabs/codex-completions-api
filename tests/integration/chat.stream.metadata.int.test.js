import { test, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import fetch from "node-fetch";
import { startServer, stopServer, wait } from "./helpers.js";
import { parseSSE } from "../shared/transcript-utils.js";

/* eslint-disable security/detect-object-injection */

let child;

afterEach(async () => {
  if (child) {
    await stopServer(child);
    child = undefined;
  }
});

const readLastLogEntry = async (filePath) => {
  // Dynamic tmp file path created by the test setup; safe for deterministic QA artifact checks.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const data = await fs.readFile(filePath, "utf8");
  const lines = data
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  return JSON.parse(lines[lines.length - 1]);
};

const readTelemetryEntries = async (filePath) => {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- controlled tmp path for tests
    const data = await fs.readFile(filePath, "utf8");
    return data
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
};

const collectStreamContent = (entries) => {
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

test("sanitizes streaming metadata when toggle enabled", async () => {
  const tokenLogPath = path.join(os.tmpdir(), `stream-metadata-enabled-${Date.now()}-usage.ndjson`);
  const telemetryLogPath = path.join(
    os.tmpdir(),
    `stream-metadata-enabled-${Date.now()}-telemetry.ndjson`
  );
  const { PORT, child: proc } = await startServer({
    PROXY_SANITIZE_METADATA: "true",
    FAKE_CODEX_METADATA: "true",
    TOKEN_LOG_PATH: tokenLogPath,
    SANITIZER_LOG_PATH: telemetryLogPath,
  });
  child = proc;

  const response = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions?stream=true`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-sk-ci",
    },
    body: JSON.stringify({
      model: "codex-5",
      stream: true,
      messages: [{ role: "user", content: "hello" }],
    }),
  });

  expect(response.ok).toBe(true);
  const raw = await response.text();
  const entries = parseSSE(raw);
  const content = collectStreamContent(entries);
  expect(content).toContain("Hello from fake-codex.");
  expect(content).not.toContain("rollout_path");
  expect(content).not.toContain("session_id");

  const firstDataEntry = entries.find((entry) => entry.type === "data");
  expect(firstDataEntry?.data?.choices?.[0]?.delta?.role).toBe("assistant");

  const finishIndex = entries.findIndex((entry) => {
    if (entry?.type !== "data") return false;
    const payload = entry.data ?? {};
    // Fixtures control payload shape; accessing choices is safe for contract validation.
    const suppliedChoices = payload.choices;
    const choices = Array.isArray(suppliedChoices) ? suppliedChoices : [];
    return choices.some((choice) => choice?.finish_reason);
  });
  expect(finishIndex).toBeGreaterThan(-1);
  const finishChunk = entries[finishIndex]?.data ?? {};
  const finishChoices = Array.isArray(finishChunk.choices) ? finishChunk.choices : [];
  expect(finishChoices.every((choice) => choice?.finish_reason === "stop")).toBe(true);

  const doneIndex = entries.findIndex((entry) => entry.type === "done");
  expect(doneIndex).toBeGreaterThan(-1);
  expect(finishIndex).toBeLessThan(doneIndex);

  const usageIndex = entries.findIndex((entry) => entry.type === "data" && entry.data?.usage);
  if (usageIndex !== -1) {
    expect(finishIndex).toBeLessThan(usageIndex);
    expect(usageIndex).toBeLessThan(doneIndex);
  }
  expect(entries.at(-1)?.type).toBe("done");

  await wait(50);
  const usageEntry = await readLastLogEntry(tokenLogPath);
  expect(usageEntry).not.toBeNull();
  expect(usageEntry.metadata_sanitizer_enabled).toBe(true);
  expect(usageEntry.sanitized_metadata_count).toBeGreaterThanOrEqual(2);
  expect(usageEntry.sanitized_metadata_keys).toContain("rollout_path");
  expect(usageEntry.sanitized_metadata_keys).toContain("session_id");
  expect(Array.isArray(usageEntry.sanitized_metadata_sources)).toBe(true);
  expect(usageEntry.sanitized_metadata_sources).toContain("message.metadata");

  const telemetryEntries = await readTelemetryEntries(telemetryLogPath);
  const toggleEntries = telemetryEntries.filter(
    (entry) => entry.kind === "proxy_sanitize_metadata"
  );
  expect(toggleEntries).not.toHaveLength(0);
  expect(toggleEntries[0].enabled).toBe(true);
  const summaryEntry = telemetryEntries.find(
    (entry) => entry.kind === "metadata_sanitizer_summary"
  );
  expect(summaryEntry).toBeDefined();
  expect(summaryEntry.sanitized_keys).toEqual(
    expect.arrayContaining(["rollout_path", "session_id"])
  );
  expect(summaryEntry.sanitized_sources).toEqual(expect.arrayContaining(["message.metadata"]));
  expect(summaryEntry.enabled).toBe(true);
});

test("retains streaming metadata when toggle disabled", async () => {
  const tokenLogPath = path.join(
    os.tmpdir(),
    `stream-metadata-disabled-${Date.now()}-usage.ndjson`
  );
  const telemetryLogPath = path.join(
    os.tmpdir(),
    `stream-metadata-disabled-${Date.now()}-telemetry.ndjson`
  );
  const { PORT, child: proc } = await startServer({
    PROXY_SANITIZE_METADATA: "false",
    FAKE_CODEX_METADATA: "true",
    TOKEN_LOG_PATH: tokenLogPath,
    SANITIZER_LOG_PATH: telemetryLogPath,
  });
  child = proc;

  const response = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions?stream=true`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-sk-ci",
    },
    body: JSON.stringify({
      model: "codex-5",
      stream: true,
      messages: [{ role: "user", content: "hello" }],
    }),
  });

  expect(response.ok).toBe(true);
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
  expect(Array.isArray(usageEntry.sanitized_metadata_sources)).toBe(true);
  expect(usageEntry.sanitized_metadata_sources).toHaveLength(0);

  const telemetryEntries = await readTelemetryEntries(telemetryLogPath);
  const toggleEntries = telemetryEntries.filter(
    (entry) => entry.kind === "proxy_sanitize_metadata"
  );
  expect(toggleEntries).toHaveLength(1);
  expect(toggleEntries[0].enabled).toBe(false);
  const summaryEntries = telemetryEntries.filter(
    (entry) => entry.kind === "metadata_sanitizer_summary"
  );
  expect(summaryEntries).toHaveLength(0);
});
