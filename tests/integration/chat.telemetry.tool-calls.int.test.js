import { describe, expect, test } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import fetch from "node-fetch";
import { startServer, stopServer, wait } from "./helpers.js";
import { buildBurstEnv, buildLegacyCapEnv } from "../support/fixtures/tool-burst.fixture.js";

const REQUEST_BODY = {
  model: "codex-5",
  messages: [{ role: "user", content: "emit multi tool burst" }],
};

const createLogPaths = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codex-tool-telemetry-"));
  return {
    dir,
    usagePath: path.join(dir, "usage.ndjson"),
    protoPath: path.join(dir, "proto.ndjson"),
  };
};

const readNdjson = async (filePath) => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- log path determined during test setup
  if (!existsSync(filePath)) return [];
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- log path determined during test setup
  const raw = await readFile(filePath, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
};

const streamRequest = async (port) => {
  const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions?stream=true`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-sk-ci",
    },
    body: JSON.stringify({ ...REQUEST_BODY, stream: true }),
  });
  expect(response.ok).toBe(true);
  await response.text();
};

describe("chat telemetry for tool bursts", () => {
  test("records burst stats for multi-call turns", async () => {
    const { usagePath, protoPath } = await createLogPaths();
    const serverCtx = await startServer({
      ...buildBurstEnv({ burstCount: 3 }),
      PROXY_ENV: "dev",
      TOKEN_LOG_PATH: usagePath,
      PROTO_LOG_PATH: protoPath,
    });
    try {
      await streamRequest(serverCtx.PORT);
      await wait(200); // allow usage/proto writers to flush
    } finally {
      await stopServer(serverCtx.child);
    }

    const usageEntries = await readNdjson(usagePath);
    const requestEntry = usageEntries.find(
      (entry) => entry?.route === "/v1/chat/completions" && entry?.stream === true
    );
    expect(requestEntry?.tool_call_count_total).toBeGreaterThanOrEqual(3);
    expect(requestEntry?.tool_call_truncated_total).toBe(0);
    expect(requestEntry?.stop_after_tools_mode).toBe("burst");

    const protoEntries = await readNdjson(protoPath);
    const summary = protoEntries.find((entry) => entry?.kind === "tool_call_summary");
    expect(summary?.tool_call_count_total).toBeGreaterThanOrEqual(3);
    expect(summary?.tool_call_truncated_total).toBe(0);
    expect(summary?.stop_after_tools_mode).toBe("burst");
    expect(summary?.tool_block_max).toBe(0);
    expect(summary?.suppress_tail_after_tools).toBe(true);
  });

  test("captures truncation when stop-after-tools forces legacy mode", async () => {
    const { usagePath, protoPath } = await createLogPaths();
    const serverCtx = await startServer({
      ...buildLegacyCapEnv({ burstCount: 3, blockMax: 1, stopAfterMode: "first" }),
      PROXY_ENV: "dev",
      TOKEN_LOG_PATH: usagePath,
      PROTO_LOG_PATH: protoPath,
    });
    try {
      await streamRequest(serverCtx.PORT);
      await wait(200);
    } finally {
      await stopServer(serverCtx.child);
    }

    const usageEntries = await readNdjson(usagePath);
    const requestEntry = usageEntries.find(
      (entry) => entry?.route === "/v1/chat/completions" && entry?.stream === true
    );
    expect(requestEntry?.tool_call_count_total).toBe(1);
    expect(requestEntry?.tool_call_truncated_total).toBe(1);
    expect(requestEntry?.stop_after_tools_mode).toBe("first");

    const protoEntries = await readNdjson(protoPath);
    const summary = protoEntries.find((entry) => entry?.kind === "tool_call_summary");
    expect(summary?.tool_call_count_total).toBe(1);
    expect(summary?.tool_call_truncated_total).toBe(1);
    expect(summary?.stop_after_tools_mode).toBe("first");
    expect(summary?.tool_block_max).toBe(1);
    expect(summary?.suppress_tail_after_tools).toBe(true);
  });
});
