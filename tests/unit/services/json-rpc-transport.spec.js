import { PassThrough } from "node:stream";
import { afterAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_HANDSHAKE_TIMEOUT = process.env.WORKER_HANDSHAKE_TIMEOUT_MS;
const ORIGINAL_REQUEST_TIMEOUT = process.env.WORKER_REQUEST_TIMEOUT_MS;

process.env.WORKER_HANDSHAKE_TIMEOUT_MS = "20";
process.env.WORKER_REQUEST_TIMEOUT_MS = "20";

const supervisorMock = {
  waitForReady: vi.fn(() => Promise.resolve()),
  status: vi.fn(() => ({ ready: true })),
};

const state = {
  child: null,
  handlers: new Map(),
};

vi.mock("../../../src/services/backend-mode.js", () => ({
  selectBackendMode: vi.fn(() => "app-server"),
  isAppServerMode: vi.fn(() => true),
}));

vi.mock("../../../src/services/worker/supervisor.js", () => ({
  ensureWorkerSupervisor: vi.fn(),
  getWorkerSupervisor: () => supervisorMock,
  getWorkerChildProcess: () => state.child,
  onWorkerSupervisorEvent: (event, handler) => {
    state.handlers.set(event, handler);
    return () => {
      const current = state.handlers.get(event);
      if (current === handler) {
        state.handlers.delete(event);
      }
    };
  },
  isWorkerSupervisorReady: vi.fn(() => true),
  __setChild(value) {
    state.child = value;
    const spawnHandler = state.handlers.get("spawn");
    if (value && spawnHandler) spawnHandler(value);
  },
}));

const { getJsonRpcTransport, resetJsonRpcTransport, TransportError, mapTransportError } =
  await import("../../../src/services/transport/index.js");
const { __setChild } = await import("../../../src/services/worker/supervisor.js");
const { config: CFG } = await import("../../../src/config/index.js");

const ORIGINAL_MAX_CONCURRENCY = CFG.WORKER_MAX_CONCURRENCY;

function createMockChild() {
  const stdout = new PassThrough({ encoding: "utf8" });
  const stderr = new PassThrough({ encoding: "utf8" });
  const stdin = new PassThrough({ encoding: "utf8" });
  return {
    stdout,
    stderr,
    stdin,
    kill: vi.fn(),
    destroy() {
      stdout.destroy();
      stderr.destroy();
      stdin.destroy();
    },
  };
}

beforeEach(() => {
  resetJsonRpcTransport();
  __setChild(null);
  state.child = null;
  state.handlers = new Map();
  supervisorMock.waitForReady.mockResolvedValue();
  vi.clearAllMocks();
  CFG.WORKER_MAX_CONCURRENCY = ORIGINAL_MAX_CONCURRENCY;
});

describe("mapTransportError", () => {
  it("treats app_server_disabled as non-retryable server error", () => {
    const message = "JSON-RPC transport requested while app-server mode disabled";
    const err = new TransportError(message, { code: "app_server_disabled", retryable: false });

    const mapped = mapTransportError(err);

    expect(mapped).toMatchObject({
      statusCode: 500,
      body: {
        error: {
          code: "app_server_disabled",
          type: "server_error",
          message,
        },
      },
    });
    expect(mapped.body.error).not.toHaveProperty("retryable");
  });

  it("preserves worker error messages", () => {
    const err = new TransportError("worker crashed with code 42", {
      code: "worker_error",
      retryable: false,
    });

    const mapped = mapTransportError(err);

    expect(mapped.statusCode).toBe(500);
    expect(mapped.body.error).toMatchObject({
      code: "worker_error",
      type: "server_error",
      message: "worker crashed with code 42",
    });
    expect(mapped.body.error).not.toHaveProperty("retryable");
  });
});

afterEach(() => {
  const child = state.child;
  if (child?.destroy) child.destroy();
  __setChild(null);
  resetJsonRpcTransport();
  vi.useRealTimers();
});

afterAll(() => {
  if (ORIGINAL_HANDSHAKE_TIMEOUT === undefined) {
    delete process.env.WORKER_HANDSHAKE_TIMEOUT_MS;
  } else {
    process.env.WORKER_HANDSHAKE_TIMEOUT_MS = ORIGINAL_HANDSHAKE_TIMEOUT;
  }
  if (ORIGINAL_REQUEST_TIMEOUT === undefined) {
    delete process.env.WORKER_REQUEST_TIMEOUT_MS;
  } else {
    process.env.WORKER_REQUEST_TIMEOUT_MS = ORIGINAL_REQUEST_TIMEOUT;
  }
});

describe("JsonRpcTransport handshake", () => {
  it("resolves handshake and captures advertised models", async () => {
    const child = createMockChild();
    child.stdin.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (!text) return;
      const message = JSON.parse(text);
      if (message.method === "initialize") {
        child.stdout.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            result: { advertised_models: ["codex-5"] },
          }) + "\n"
        );
      }
    });
    __setChild(child);

    const transport = getJsonRpcTransport();
    const handshake = await transport.ensureHandshake();

    expect(handshake.models).toEqual(["codex-5"]);
  });

  it("supports handshake responses that expose models array", async () => {
    const child = createMockChild();
    child.stdin.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (!text) return;
      const message = JSON.parse(text);
      if (message.method === "initialize") {
        child.stdout.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            result: { models: ["codex-6"] },
          }) + "\n"
        );
      }
    });
    __setChild(child);

    const transport = getJsonRpcTransport();
    const handshake = await transport.ensureHandshake();

    expect(handshake.models).toEqual(["codex-6"]);
  });

  it("rejects when handshake does not complete before timeout", async () => {
    vi.useFakeTimers();
    const child = createMockChild();
    child.stdin.on("data", () => {
      // Intentionally do nothing to simulate no handshake response
    });
    __setChild(child);

    const transport = getJsonRpcTransport();
    const handshakePromise = transport.ensureHandshake();
    const expectation = expect(handshakePromise).rejects.toMatchObject({
      code: "handshake_timeout",
    });

    await vi.runAllTimersAsync();
    await expectation;
  });
});

describe("JsonRpcTransport request lifecycle", () => {
  it("rejects new requests when the worker is at capacity", async () => {
    CFG.WORKER_MAX_CONCURRENCY = 1;
    const child = createMockChild();
    child.stdin.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (!text) return;
      for (const line of text.split(/\n+/)) {
        if (!line) continue;
        const message = JSON.parse(line);
        if (message.method === "initialize") {
          child.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} }) + "\n");
        }
        if (message.method === "sendUserTurn") {
          child.stdout.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              result: { conversation_id: "server-conv" },
            }) + "\n"
          );
        }
      }
    });
    __setChild(child);

    const transport = getJsonRpcTransport();
    const context = await transport.createChatRequest({ requestId: "req-1" });
    context.emitter.on("error", () => {});

    await expect(transport.createChatRequest({ requestId: "req-2" })).rejects.toMatchObject({
      code: "worker_busy",
    });

    const pending = context.promise.catch((err) => err);
    transport.cancelContext(
      context,
      new TransportError("request aborted", { code: "request_aborted", retryable: false })
    );
    await expect(pending).resolves.toMatchObject({ code: "request_aborted" });

    const next = await transport.createChatRequest({ requestId: "req-3" });
    next.emitter.on("error", () => {});
    const nextPending = next.promise.catch((err) => err);
    transport.cancelContext(
      next,
      new TransportError("request aborted", { code: "request_aborted" })
    );
    await expect(nextPending).resolves.toMatchObject({ code: "request_aborted" });
  });

  it("emits notifications and finalizes request payloads", async () => {
    CFG.WORKER_MAX_CONCURRENCY = 2;
    const child = createMockChild();
    child.stdin.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (!text) return;
      for (const line of text.split(/\n+/)) {
        if (!line) continue;
        const message = JSON.parse(line);
        if (message.method === "initialize") {
          child.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} }) + "\n");
        }
        if (message.method === "sendUserTurn") {
          child.stdout.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              result: { conversation_id: "server-conv" },
            }) + "\n"
          );
        }
        if (message.method === "sendUserMessage") {
          child.stdout.write(
            JSON.stringify({
              jsonrpc: "2.0",
              method: "agentMessageDelta",
              params: { conversation_id: "server-conv", delta: "Hi" },
            }) + "\n"
          );
          child.stdout.write(
            JSON.stringify({
              jsonrpc: "2.0",
              method: "agentMessage",
              params: { conversation_id: "server-conv", text: "Hello world!" },
            }) + "\n"
          );
          child.stdout.write(
            JSON.stringify({
              jsonrpc: "2.0",
              method: "tokenCount",
              params: {
                conversation_id: "server-conv",
                prompt_tokens: 5,
                completion_tokens: 7,
                finish_reason: "stop",
              },
            }) + "\n"
          );
          child.stdout.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              result: { status: "complete", finish_reason: "stop" },
            }) + "\n"
          );
        }
      }
    });
    __setChild(child);

    const transport = getJsonRpcTransport();
    const context = await transport.createChatRequest({ requestId: "req-10" });

    const deltas = [];
    const messages = [];
    const usageEvents = [];
    context.emitter.on("delta", (payload) => deltas.push(payload));
    context.emitter.on("message", (payload) => messages.push(payload));
    context.emitter.on("usage", (payload) => usageEvents.push(payload));

    transport.sendUserMessage(context, { text: "Hello" });
    const result = await context.promise;

    expect(deltas).toEqual([{ conversation_id: "server-conv", delta: "Hi" }]);
    expect(messages).toEqual([{ conversation_id: "server-conv", text: "Hello world!" }]);
    expect(usageEvents.at(-1)).toMatchObject({
      prompt_tokens: 5,
      completion_tokens: 7,
      finish_reason: "stop",
    });
    expect(result).toMatchObject({
      conversationId: "server-conv",
      finishReason: "stop",
      finalMessage: { conversation_id: "server-conv", text: "Hello world!" },
      usage: { prompt_tokens: 5, completion_tokens: 7 },
      deltas: [{ conversation_id: "server-conv", delta: "Hi" }],
      result: { status: "complete", finish_reason: "stop" },
    });

    const followUp = await transport.createChatRequest({ requestId: "req-11" });
    followUp.emitter.on("error", () => {});
    const followUpPending = followUp.promise.catch((err) => err);
    transport.cancelContext(
      followUp,
      new TransportError("request aborted", { code: "request_aborted" })
    );
    await expect(followUpPending).resolves.toMatchObject({ code: "request_aborted" });
  });

  it("cancels contexts with a default abort error when none is provided", async () => {
    CFG.WORKER_MAX_CONCURRENCY = 1;
    const child = createMockChild();
    child.stdin.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (!text) return;
      for (const line of text.split(/\n+/)) {
        if (!line) continue;
        const message = JSON.parse(line);
        if (message.method === "initialize") {
          child.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} }) + "\n");
        }
        if (message.method === "sendUserTurn") {
          child.stdout.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              result: { conversation_id: "server-conv" },
            }) + "\n"
          );
        }
      }
    });
    __setChild(child);

    const transport = getJsonRpcTransport();
    const context = await transport.createChatRequest({ requestId: "req-20" });
    context.emitter.on("error", () => {});

    const pending = context.promise.catch((err) => err);
    transport.cancelContext(context);

    await expect(pending).resolves.toMatchObject({
      message: "request aborted",
      code: "request_aborted",
    });

    const replacement = await transport.createChatRequest({ requestId: "req-21" });
    replacement.emitter.on("error", () => {});
    const replacementPending = replacement.promise.catch((err) => err);
    transport.cancelContext(replacement);
    await expect(replacementPending).resolves.toMatchObject({ code: "request_aborted" });
  });
});
