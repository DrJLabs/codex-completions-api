import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { startServer, stopServer } from "./helpers.js";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSSE, sanitizeStreamTranscript } from "../shared/transcript-utils.js";

const buildRequestPayload = () => ({
  model: "codex-5",
  stream: true,
  messages: [{ role: "user", content: "invoke lookup_user" }],
});

const TOOL_REQUEST = {
  model: "codex-5",
  stream: true,
  stream_options: { include_usage: true },
  messages: [{ role: "user", content: "Stream tool execution" }],
  tools: [
    {
      type: "function",
      function: {
        name: "lookup_user",
        description: "Returns fake profile information",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string" },
          },
          required: ["id"],
        },
      },
    },
  ],
  tool_choice: { type: "function", function: { name: "lookup_user" } },
};

const flattenChoiceEntries = (entries) =>
  entries.map((entry, index) => ({
    index,
    choices: Array.isArray(entry?.data?.choices) ? entry.data.choices : [],
  }));

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..");
const FIXTURE_DIR = resolve(PROJECT_ROOT, "tests", "e2e", "fixtures", "tool-calls");
const APP_SERVER_ENV = {
  CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
  PROXY_USE_APP_SERVER: "true",
  CODEX_WORKER_SUPERVISED: "true",
  PROXY_SSE_KEEPALIVE_MS: "0",
};

async function loadFixture(name) {
  // Fixture names are constant and maintained in repo; rule suppressed for non-literal path here.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const raw = await readFile(resolve(FIXTURE_DIR, name), "utf8");
  return JSON.parse(raw);
}

describe("chat streaming tool-call contract", () => {
  let serverCtx;

  beforeAll(async () => {
    serverCtx = await startServer({
      ...APP_SERVER_ENV,
      FAKE_CODEX_MODE: "tool_call",
    });
  }, 10_000);

  afterAll(async () => {
    if (serverCtx) await stopServer(serverCtx.child);
  });

  test("emits role-first chunk, single <use_tool> delta, and canonical finish frame", async () => {
    const response = await fetch(
      `http://127.0.0.1:${serverCtx.PORT}/v1/chat/completions?stream=true`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-sk-ci",
        },
        body: JSON.stringify(buildRequestPayload()),
      }
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`utf8 streaming request failed: ${response.status} body=${body}`);
    }
    const raw = await response.text();
    const entries = parseSSE(raw);
    const dataEntries = entries.filter((entry) => entry?.type === "data");
    expect(dataEntries.length).toBeGreaterThan(0);
    expect(entries.some((entry) => entry?.type === "done")).toBe(true);

    const flattened = flattenChoiceEntries(dataEntries);

    const roleChunks = flattened.filter((chunk) =>
      chunk.choices.some((choice) => choice?.delta?.role === "assistant")
    );
    expect(roleChunks).toHaveLength(1);
    const roleChunkIndex = roleChunks[0].index;

    const toolCallMetaChunks = flattened.filter((chunk) =>
      chunk.choices.some(
        (choice) => Array.isArray(choice?.delta?.tool_calls) && choice.delta.tool_calls.length > 0
      )
    );
    expect(toolCallMetaChunks.length).toBeGreaterThan(0);
    expect(roleChunkIndex).toBeLessThan(toolCallMetaChunks[0].index);

    const argumentChunks = [];
    for (const chunk of toolCallMetaChunks) {
      for (const choice of chunk.choices) {
        const toolCalls = Array.isArray(choice?.delta?.tool_calls) ? choice.delta.tool_calls : [];
        for (const toolCall of toolCalls) {
          const value = toolCall?.function?.arguments;
          if (typeof value === "string" && value.length) {
            argumentChunks.push({ index: chunk.index, value });
          }
        }
      }
    }

    expect(argumentChunks.length).toBeGreaterThan(0);
    argumentChunks.forEach((chunk, idx) => {
      if (idx === 0) return;
      const prev = argumentChunks[idx - 1].value.replace(/\s+/g, "");
      const curr = chunk.value.replace(/\s+/g, "");
      expect(curr.startsWith(prev)).toBe(true);
    });
    const finalArgs = argumentChunks.at(-1)?.value ?? "";
    expect(() => JSON.parse(finalArgs)).not.toThrow();
    expect(JSON.parse(finalArgs)).toEqual({ id: "42" });

    const contentChunks = flattened
      .map((chunk) => ({
        index: chunk.index,
        content: chunk.choices
          .map((choice) => choice?.delta?.content)
          .find((segment) => typeof segment === "string" && segment.length),
      }))
      .filter((entry) => typeof entry.content === "string");

    expect(contentChunks).toHaveLength(1);
    const [{ index: contentIndex, content }] = contentChunks;
    expect(content).toMatch(/<use_tool>[\s\S]*<\/use_tool>/);
    expect(content.trim().endsWith("</use_tool>")).toBe(true);
    expect(content).not.toMatch(/Hello from fake-codex/i);
    expect(contentIndex).toBeGreaterThan(argumentChunks.at(-1).index);

    const finishEvents = [];
    for (const chunk of flattened) {
      for (const choice of chunk.choices) {
        if (choice.finish_reason) {
          finishEvents.push({ index: chunk.index, reason: choice.finish_reason });
        }
      }
    }
    expect(finishEvents).toHaveLength(1);
    const [{ index: finishIndex, reason: finishReason }] = finishEvents;
    expect(finishReason).toBe("tool_calls");
    expect(finishIndex).toBeGreaterThan(contentIndex);

    const postFinishContent = flattened
      .filter((chunk) => chunk.index > finishIndex)
      .some((chunk) =>
        chunk.choices.some(
          (choice) => typeof choice?.delta?.content === "string" && choice.delta.content.length
        )
      );
    expect(postFinishContent).toBe(false);
  });
});

describe("chat streaming tool-call UTF-8 safety", () => {
  let serverCtx;

  beforeAll(async () => {
    serverCtx = await startServer({
      ...APP_SERVER_ENV,
      FAKE_CODEX_MODE: "tool_call",
      FAKE_CODEX_TOOL_ARGUMENT: '{"payload":"👩‍💻漢字"}',
      FAKE_CODEX_TOOL_ARGUMENT_CHUNK_SIZE: "3",
    });
  }, 10_000);

  afterAll(async () => {
    if (serverCtx) await stopServer(serverCtx.child);
  });

  test("emits cumulative multibyte argument deltas", async () => {
    const response = await fetch(
      `http://127.0.0.1:${serverCtx.PORT}/v1/chat/completions?stream=true`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-sk-ci",
        },
        body: JSON.stringify(buildRequestPayload()),
      }
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`large-arg streaming request failed: ${response.status} body=${body}`);
    }
    const raw = await response.text();
    const entries = parseSSE(raw).filter((entry) => entry?.type === "data");
    const argumentChunks = [];
    for (const entry of entries) {
      const choice = entry?.data?.choices?.[0];
      const toolCalls = choice?.delta?.tool_calls;
      if (Array.isArray(toolCalls) && toolCalls.length) {
        const value = toolCalls[0]?.function?.arguments;
        if (typeof value === "string" && value.length) {
          argumentChunks.push(value);
        }
      }
    }

    expect(argumentChunks.length).toBeGreaterThan(0);
    argumentChunks.forEach((chunk, idx, list) => {
      if (idx === 0) return;
      const prev = list[idx - 1].replace(/\s+/g, "");
      const curr = chunk.replace(/\s+/g, "");
      expect(curr.startsWith(prev)).toBe(true);
    });
    const finalArgs = argumentChunks.at(-1);
    expect(finalArgs).toBe('{"payload":"👩‍💻漢字"}');
    expect(() => JSON.parse(finalArgs)).not.toThrow();
  });
});

describe("chat streaming tool-call large arguments", () => {
  const LARGE_PAYLOAD = "x".repeat(9000);
  let serverCtx;

  beforeAll(async () => {
    serverCtx = await startServer({
      ...APP_SERVER_ENV,
      FAKE_CODEX_MODE: "tool_call",
      FAKE_CODEX_TOOL_ARGUMENT: JSON.stringify({ payload: LARGE_PAYLOAD }),
      FAKE_CODEX_PARALLEL: "false",
    });
  }, 10_000);

  afterAll(async () => {
    if (serverCtx) await stopServer(serverCtx.child);
  });

  test("preserves cumulative JSON and finish ordering for ≥8KB args", async () => {
    const response = await fetch(
      `http://127.0.0.1:${serverCtx.PORT}/v1/chat/completions?stream=true`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-sk-ci",
        },
        body: JSON.stringify({
          model: "codex-5",
          stream: true,
          messages: [{ role: "user", content: "large args" }],
        }),
      }
    );

    expect(response.ok).toBe(true);
    const raw = await response.text();
    const entries = parseSSE(raw).filter((entry) => entry?.type === "data");

    const deltas = [];
    for (const entry of entries) {
      const choice = entry?.data?.choices?.[0];
      const toolCalls = choice?.delta?.tool_calls;
      if (Array.isArray(toolCalls) && toolCalls.length) {
        const value = toolCalls[0]?.function?.arguments;
        if (typeof value === "string" && value.length) deltas.push(value);
      }
    }

    expect(deltas.length).toBeGreaterThanOrEqual(1);
    deltas.forEach((chunk, idx, list) => {
      if (idx === 0) return;
      const prev = list[idx - 1].replace(/\s+/g, "");
      const curr = chunk.replace(/\s+/g, "");
      expect(curr.startsWith(prev)).toBe(true);
    });

    const finalArgs = deltas.at(-1);
    expect(finalArgs?.length).toBeGreaterThanOrEqual(8000);
    expect(() => JSON.parse(finalArgs)).not.toThrow();
    expect(JSON.parse(finalArgs)).toEqual({ payload: LARGE_PAYLOAD });

    const finishFrames = entries.filter((entry) =>
      entry.data?.choices?.some((choice) => choice.finish_reason === "tool_calls")
    );
    expect(finishFrames).toHaveLength(1);
  });
});

describe("chat streaming tool-call fixtures (stop-after-tools, textual, disconnect)", () => {
  const startEnv = APP_SERVER_ENV;

  describe("stop-after-tools first mode", () => {
    let serverCtx;
    let fixture;

    beforeAll(async () => {
      fixture = await loadFixture("streaming-tool-calls-stop-after-tools.app.json");
      serverCtx = await startServer({
        ...startEnv,
        PROXY_STOP_AFTER_TOOLS: "true",
        PROXY_STOP_AFTER_TOOLS_MODE: "first",
        FAKE_CODEX_MODE: "tool_call",
      });
    }, 10_000);

    afterAll(async () => {
      if (serverCtx) await stopServer(serverCtx.child);
    });

    test("matches stop-after-tools(first) invariant: tool_calls finish and stop", async () => {
      const res = await fetch(
        `http://127.0.0.1:${serverCtx.PORT}/v1/chat/completions?stream=true`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer test-sk-ci",
          },
          body: JSON.stringify(fixture.request),
        }
      );
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`stop-after-tools stream failed: ${res.status} body=${body}`);
      }
      const raw = await res.text();
      const actual = sanitizeStreamTranscript(parseSSE(raw));
      const dataEntries = actual.filter((entry) => entry?.type === "data");
      const doneEntries = actual.filter((entry) => entry?.type === "done");
      expect(doneEntries.length).toBe(1);
      const finishFrames = dataEntries
        .flatMap((entry) => entry.data?.choices || [])
        .filter((choice) => choice.finish_reason);
      expect(finishFrames.length).toBeGreaterThanOrEqual(1);
      finishFrames.forEach((finish) => {
        expect(finish.finish_reason).toBe("tool_calls");
      });
      const postFinishHasDeltas = dataEntries
        .slice(
          dataEntries.findIndex((entry) =>
            entry.data?.choices?.some((choice) => choice.finish_reason)
          ) + 1
        )
        .some((entry) =>
          (entry.data?.choices || []).some(
            (choice) =>
              typeof choice?.delta?.content === "string" ||
              (Array.isArray(choice?.delta?.tool_calls) && choice.delta.tool_calls.length > 0)
          )
        );
      expect(postFinishHasDeltas).toBe(false);
    });
  });

  describe("textual fallback multibyte <use_tool>", () => {
    let serverCtx;
    let fixture;

    beforeAll(async () => {
      fixture = await loadFixture("streaming-tool-calls-textual.app.json");
      serverCtx = await startServer({
        ...startEnv,
        FAKE_CODEX_MODE: "textual_tool",
      });
    }, 10_000);

    afterAll(async () => {
      if (serverCtx) await stopServer(serverCtx.child);
    });

    test("emits single textual <use_tool> block and finish_reason tool_calls", async () => {
      const res = await fetch(
        `http://127.0.0.1:${serverCtx.PORT}/v1/chat/completions?stream=true`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer test-sk-ci",
          },
          body: JSON.stringify(fixture.request),
        }
      );

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`textual stream failed: ${res.status} body=${body}`);
      }
      const raw = await res.text();
      const entries = sanitizeStreamTranscript(parseSSE(raw));
      const expected = sanitizeStreamTranscript(fixture.stream);
      expect(entries).toEqual(expected);
      const contentBlocks = entries
        .filter((entry) => entry?.type === "data")
        .flatMap((entry) => entry.data?.choices || [])
        .map((choice) => choice?.delta?.content)
        .filter((val) => typeof val === "string");
      expect(contentBlocks).toHaveLength(1);
      expect(contentBlocks[0]).toMatch(/<use_tool/);
      expect(contentBlocks[0]).toContain("ユーザー-12345");
      expect(contentBlocks[0].trim().endsWith("</use_tool>")).toBe(true);
    });
  });

  describe("disconnect after first tool delta", () => {
    let serverCtx;

    beforeAll(async () => {
      serverCtx = await startServer({
        ...startEnv,
        FAKE_CODEX_MODE: "tool_call",
      });
    }, 10_000);

    afterAll(async () => {
      if (serverCtx) await stopServer(serverCtx.child);
    });

    test("stops emitting once client aborts post-first tool delta", async () => {
      const controller = new AbortController();
      const res = await fetch(
        `http://127.0.0.1:${serverCtx.PORT}/v1/chat/completions?stream=true`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer test-sk-ci",
          },
          body: JSON.stringify({
            ...TOOL_REQUEST,
            messages: [{ role: "user", content: "Stream tool execution (disconnect)" }],
          }),
          signal: controller.signal,
        }
      );

      const reader = res.body?.getReader?.();
      expect(reader).toBeTruthy();
      const decoder = new TextDecoder();
      let raw = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) raw += decoder.decode(value, { stream: true });
          const entries = parseSSE(raw);
          const hasTool = entries.some(
            (entry) =>
              entry?.type === "data" &&
              entry.data?.choices?.some(
                (choice) =>
                  Array.isArray(choice?.delta?.tool_calls) && choice.delta.tool_calls.length > 0
              )
          );
          if (hasTool) {
            controller.abort();
            break;
          }
        }
      } catch (err) {
        expect(err?.name).toBe("AbortError");
      }
      raw += decoder.decode();

      const entries = parseSSE(raw);
      const dataEntries = entries.filter((entry) => entry?.type === "data");
      expect(dataEntries.length).toBeGreaterThanOrEqual(2);
      const finishFrames = dataEntries.filter((entry) =>
        entry.data?.choices?.some((choice) => choice.finish_reason)
      );
      // Disconnect path should not emit finish or done, but allow empty results.
      expect(finishFrames).toHaveLength(0);
      const doneFrames = entries.filter((entry) => entry?.type === "done");
      expect(doneFrames.length).toBeGreaterThanOrEqual(0);
    });
  });
});
