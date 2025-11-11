import { beforeAll, afterAll, describe, expect, test } from "vitest";
import fetch from "node-fetch";
import { startServer, stopServer } from "./helpers.js";
import { parseSSE } from "../shared/transcript-utils.js";
import { buildBurstEnv, buildLegacyCapEnv } from "../support/fixtures/tool-burst.fixture.js";
import { createToolBurst } from "../support/factories/tool-call.factory.js";

const STREAM_BURST = createToolBurst(2);
const NON_STREAM_BURST = createToolBurst(3);

const REQUEST_BODY = {
  model: "codex-5",
  messages: [{ role: "user", content: "emit multi tool burst" }],
};

const collectToolDeltaCount = (entries) => {
  let count = 0;
  for (const entry of entries) {
    if (entry?.type !== "data") continue;
    const choices = Array.isArray(entry.data?.choices) ? entry.data.choices : [];
    for (const choice of choices) {
      const toolCalls = choice?.delta?.tool_calls;
      if (Array.isArray(toolCalls)) {
        for (const call of toolCalls) {
          if (call?.function?.arguments || call?.function?.name) count += 1;
        }
      }
    }
  }
  return count;
};

const countToolBlocks = (entries) => {
  let blocks = 0;
  for (const entry of entries) {
    if (entry?.type !== "data") continue;
    const choices = Array.isArray(entry.data?.choices) ? entry.data.choices : [];
    for (const choice of choices) {
      for (const segment of choice?.delta?.content ? [choice.delta.content] : []) {
        if (typeof segment !== "string") continue;
        const matches = segment.match(/<use_tool>/g);
        if (matches) blocks += matches.length;
      }
    }
  }
  return blocks;
};

describe("chat streaming multi-tool bursts", () => {
  let serverCtx;

  beforeAll(async () => {
    serverCtx = await startServer(buildBurstEnv({ burstCount: 2 }));
  }, 15_000);

  afterAll(async () => {
    if (serverCtx) await stopServer(serverCtx.child);
  });

  test("streams every tool call before finish", async () => {
    const response = await fetch(
      `http://127.0.0.1:${serverCtx.PORT}/v1/chat/completions?stream=true`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-sk-ci",
        },
        body: JSON.stringify({ ...REQUEST_BODY, stream: true }),
      }
    );

    expect(response.ok).toBe(true);
    const raw = await response.text();
    const entries = parseSSE(raw);
    expect(entries.some((entry) => entry?.type === "done")).toBe(true);

    const deltaCount = collectToolDeltaCount(entries);
    expect(deltaCount).toBeGreaterThanOrEqual(STREAM_BURST.length * 2);

    const blockCount = countToolBlocks(entries);
    expect(blockCount).toBeGreaterThanOrEqual(2);

    const finishEntries = entries.filter((entry) => entry?.type === "data");
    const finishReasons = [];
    for (const entry of finishEntries) {
      const choices = Array.isArray(entry.data?.choices) ? entry.data.choices : [];
      for (const choice of choices) {
        if (choice?.finish_reason) finishReasons.push(choice.finish_reason);
      }
    }
    expect(finishReasons).toContain("tool_calls");
  });
});

describe("chat non-stream multi-tool envelopes", () => {
  let serverCtx;

  beforeAll(async () => {
    serverCtx = await startServer(buildBurstEnv({ burstCount: 3 }));
  }, 15_000);

  afterAll(async () => {
    if (serverCtx) await stopServer(serverCtx.child);
  });

  test("obsidian output concatenates all <use_tool> blocks", async () => {
    const response = await fetch(`http://127.0.0.1:${serverCtx.PORT}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-sk-ci",
      },
      body: JSON.stringify(REQUEST_BODY),
    });

    expect(response.ok).toBe(true);
    const payload = await response.json();
    const [choice] = payload?.choices || [];
    expect(choice?.message?.content).toContain("<use_tool>");
    const occurrences = choice.message.content.match(/<use_tool>/g) || [];
    expect(occurrences.length).toBeGreaterThanOrEqual(NON_STREAM_BURST.length);
    expect(choice.message.tool_calls).toBeTruthy();
    expect(choice.message.tool_calls.length).toBeGreaterThanOrEqual(NON_STREAM_BURST.length);
    expect(choice.finish_reason).toBe("tool_calls");
  });

  test("openai-json output sets content null and exposes tool_calls[]", async () => {
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
    expect(Array.isArray(choice?.message?.tool_calls)).toBe(true);
    expect(choice.message.tool_calls.length).toBeGreaterThanOrEqual(NON_STREAM_BURST.length);
  });
});

describe("tool burst config + telemetry plumbing", () => {
  let serverCtx;

  afterAll(async () => {
    if (serverCtx) await stopServer(serverCtx.child);
  });

  test("respects PROXY_TOOL_BLOCK_MAX and exposes tool telemetry headers", async () => {
    serverCtx = await startServer(buildLegacyCapEnv({ burstCount: 4 }));

    const response = await fetch(
      `http://127.0.0.1:${serverCtx.PORT}/v1/chat/completions?stream=true`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-sk-ci",
        },
        body: JSON.stringify({ ...REQUEST_BODY, stream: true }),
      }
    );

    expect(response.ok).toBe(true);
    const raw = await response.text();
    const entries = parseSSE(raw);
    const uniqueToolIds = new Set();
    for (const entry of entries) {
      if (entry?.type !== "data") continue;
      const choices = Array.isArray(entry.data?.choices) ? entry.data.choices : [];
      for (const choice of choices) {
        const deltas = Array.isArray(choice?.delta?.tool_calls) ? choice.delta.tool_calls : [];
        deltas.forEach((call) => {
          if (call?.id) uniqueToolIds.add(call.id);
        });
      }
    }
    expect(uniqueToolIds.size).toBe(1);
    const statsEntry = entries.find(
      (entry) => entry?.type === "comment" && /tool_call_count/.test(entry.comment || "")
    );
    expect(statsEntry).toBeTruthy();
    const statsPayload = statsEntry ? JSON.parse(statsEntry.comment) : null;
    expect(statsPayload?.tool_call_count).toBe(1);
    expect(statsPayload?.tool_call_truncated).toBe(true);
    expect(statsPayload?.stop_after_tools_mode).toBe("first");
    expect(response.headers.get("x-codex-stop-after-tools-mode")).toBe("first");
  });
});
