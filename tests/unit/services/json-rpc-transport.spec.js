import { PassThrough } from "node:stream";
import { afterAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_HANDSHAKE_TIMEOUT = process.env.WORKER_HANDSHAKE_TIMEOUT_MS;
const ORIGINAL_REQUEST_TIMEOUT = process.env.WORKER_REQUEST_TIMEOUT_MS;

process.env.WORKER_HANDSHAKE_TIMEOUT_MS = "20";
process.env.WORKER_REQUEST_TIMEOUT_MS = "20";
const ORIGINAL_TRACE_BODY_LIMIT = process.env.PROXY_TRACE_BODY_LIMIT;
process.env.PROXY_TRACE_BODY_LIMIT = "64";

const supervisorMock = {
  waitForReady: vi.fn(() => Promise.resolve()),
  status: vi.fn(() => ({ ready: true })),
};

const state = {
  child: null,
  handlers: new Map(),
};

const appendProtoEvent = vi.fn();
vi.mock("../../../src/dev-logging.js", () => ({ appendProtoEvent }));

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

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

function wireJsonResponder(child, handler) {
  let buffer = "";
  child.stdin.on("data", (chunk) => {
    buffer += chunk.toString();
    while (buffer.includes("\n")) {
      const newlineIndex = buffer.indexOf("\n");
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;
      const payload = JSON.parse(line);
      handler(payload);
    }
  });
}

const writeRpcResult = (child, id, payload) => {
  child.stdout.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      ...payload,
    }) + "\n"
  );
};

const writeRpcNotification = (child, method, params) => {
  child.stdout.write(
    JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
    }) + "\n"
  );
};

const waitForProtoEvents = async (minCount) => {
  const deadline = Date.now() + 500;
  while (appendProtoEvent.mock.calls.length < minCount && Date.now() < deadline) {
    await flushAsync();
  }
};

beforeEach(() => {
  resetJsonRpcTransport();
  __setChild(null);
  state.child = null;
  state.handlers = new Map();
  supervisorMock.waitForReady.mockResolvedValue();
  vi.clearAllMocks();
  appendProtoEvent.mockReset();
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

  it.each([
    ["handshake_timeout", 503, "backend_unavailable", true],
    ["handshake_failed", 503, "backend_unavailable", true],
    ["worker_unavailable", 503, "backend_unavailable", true],
    ["worker_not_ready", 503, "backend_unavailable", true],
    ["worker_exited", 503, "backend_unavailable", true],
    ["worker_busy", 429, "rate_limit_error", true],
    ["transport_destroyed", 503, "backend_unavailable", true],
    ["request_aborted", 499, "request_cancelled", false],
  ])("maps %s transport errors", (code, statusCode, type, retryable) => {
    const err = new TransportError("boom", { code, retryable });

    const mapped = mapTransportError(err);

    expect(mapped.statusCode).toBe(statusCode);
    expect(mapped.body.error.code).toBe(code);
    expect(mapped.body.error.type).toBe(type);
    if (retryable) {
      expect(mapped.body.error.retryable).toBe(true);
    } else {
      expect(mapped.body.error).not.toHaveProperty("retryable");
    }
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
  if (ORIGINAL_TRACE_BODY_LIMIT === undefined) {
    delete process.env.PROXY_TRACE_BODY_LIMIT;
  } else {
    process.env.PROXY_TRACE_BODY_LIMIT = ORIGINAL_TRACE_BODY_LIMIT;
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
        if (message.method === "newConversation") {
          child.stdout.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              result: { conversation_id: "server-conv" },
            }) + "\n"
          );
        }
        if (message.method === "addConversationListener") {
          child.stdout.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              result: { subscription_id: "sub-1" },
            }) + "\n"
          );
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
        if (message.method === "newConversation") {
          child.stdout.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              result: { conversation_id: "server-conv" },
            }) + "\n"
          );
        }
        if (message.method === "addConversationListener") {
          child.stdout.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              result: { subscription_id: "sub-1" },
            }) + "\n"
          );
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

  it("emits unknown notifications for forward compatibility", async () => {
    const child = createMockChild();
    const responses = {
      initialize: { result: {} },
      newConversation: { result: { conversation_id: "server-conv" } },
      addConversationListener: { result: { subscription_id: "sub-1" } },
      sendUserTurn: { result: { conversation_id: "server-conv" } },
    };
    wireJsonResponder(child, (message) => {
      if (Object.prototype.hasOwnProperty.call(responses, message.method)) {
        writeRpcResult(child, message.id, responses[message.method]);
      }
    });
    __setChild(child);

    const transport = getJsonRpcTransport();
    const context = await transport.createChatRequest({ requestId: "req-unknown" });
    context.promise.catch(() => {});
    const notifications = [];
    context.emitter.on("notification", (payload) => notifications.push(payload));
    context.emitter.on("error", () => {});

    writeRpcNotification(child, "codex/event/app_server_v2_deprecation_notice", {
      conversation_id: "server-conv",
      msg: { notice: "deprecation" },
    });
    await flushAsync();

    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      method: "codex/event/app_server_v2_deprecation_notice",
      params: {
        conversation_id: "server-conv",
        msg: { notice: "deprecation" },
      },
    });

    transport.cancelContext(context);
    await context.promise.catch(() => {});
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
        if (message.method === "newConversation") {
          child.stdout.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              result: { conversation_id: "server-conv" },
            }) + "\n"
          );
        }
        if (message.method === "addConversationListener") {
          child.stdout.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              result: { subscription_id: "sub-1" },
            }) + "\n"
          );
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

describe("trace logging instrumentation", () => {
  it("logs backend submissions, responses, and notifications with sanitized payloads", async () => {
    const child = createMockChild();
    const conversationId = "conv-trace";
    const trace = { reqId: "req-trace", route: "/v1/chat/completions", mode: "chat_stream" };

    wireJsonResponder(child, (message) => {
      switch (message.method) {
        case "initialize":
          writeRpcResult(child, message.id, { result: { advertised_models: ["codex-5"] } });
          break;
        case "newConversation":
          writeRpcResult(child, message.id, { result: { conversation_id: conversationId } });
          break;
        case "addConversationListener":
          writeRpcResult(child, message.id, { result: { subscription_id: "sub-trace" } });
          break;
        case "sendUserTurn":
          writeRpcResult(child, message.id, { result: { conversation_id: conversationId } });
          setTimeout(() => {
            const heavy = "x".repeat(256);
            writeRpcNotification(child, "codex/event/agent_message", {
              conversation_id: conversationId,
              request_id: "ctx-trace",
              msg: {
                metadata: { chunk: heavy },
                tool_calls: [
                  {
                    type: "function",
                    function: { name: "diagnostics", arguments: JSON.stringify({ blob: heavy }) },
                  },
                ],
              },
            });
            writeRpcNotification(child, "codex/event/task_complete", {
              conversation_id: conversationId,
              msg: { finish_reason: "stop" },
            });
          }, 0);
          break;
        default:
          break;
      }
    });
    __setChild(child);

    const transport = getJsonRpcTransport();
    const context = await transport.createChatRequest({
      requestId: "req-trace",
      timeoutMs: 50,
      turnParams: { model: "codex-5" },
      trace,
    });

    await waitForProtoEvents(8);

    const events = appendProtoEvent.mock.calls.map(([payload]) => payload);
    const rpcRequest = events.find(
      (event) => event.kind === "rpc_request" && event.method === "sendUserTurn"
    );
    expect(rpcRequest).toBeTruthy();
    expect(rpcRequest.req_id).toBe(trace.reqId);

    const rpcResponse = events.find(
      (event) => event.kind === "rpc_response" && event.method === "sendUserTurn"
    );
    expect(rpcResponse).toBeTruthy();
    expect(rpcResponse.rpc_id).toBe(rpcRequest.rpc_id);
    expect(rpcResponse.req_id).toBe(trace.reqId);

    const notification = events.find(
      (event) =>
        event.kind === "rpc_notification" &&
        event.notification_method === "codex/event/agent_message"
    );
    expect(notification).toBeTruthy();
    expect(notification.req_id).toBe(trace.reqId);
    expect(notification.payload).toMatchObject({ truncated: true });

    const toolBlock = events.find((event) => event.kind === "tool_block");
    expect(toolBlock).toBeTruthy();
    expect(toolBlock.req_id).toBe(trace.reqId);
    expect(toolBlock.payload).toMatchObject({ truncated: true });

    transport.cancelContext(context);
    await context.promise.catch(() => {});
  });

  it("logs rpc_error events with consistent req_id mapping", async () => {
    const child = createMockChild();
    const trace = { reqId: "req-error", route: "/v1/chat/completions", mode: "chat_stream" };

    wireJsonResponder(child, (message) => {
      switch (message.method) {
        case "initialize":
          writeRpcResult(child, message.id, { result: { advertised_models: ["codex-5"] } });
          break;
        case "newConversation":
          writeRpcResult(child, message.id, { result: { conversation_id: "conv-error" } });
          break;
        case "addConversationListener":
          writeRpcResult(child, message.id, { result: { subscription_id: "sub-error" } });
          break;
        case "sendUserTurn":
          writeRpcResult(child, message.id, {
            error: {
              code: 500,
              message: "worker exploded",
              data: { detail: "z".repeat(256) },
            },
          });
          break;
        default:
          break;
      }
    });
    __setChild(child);

    const transport = getJsonRpcTransport();
    const context = await transport.createChatRequest({
      requestId: "req-error",
      timeoutMs: 50,
      turnParams: { model: "codex-5" },
      trace,
    });

    await expect(context.promise).rejects.toBeInstanceOf(TransportError);
    await waitForProtoEvents(6);

    const events = appendProtoEvent.mock.calls.map(([payload]) => payload);
    const rpcRequest = [...events]
      .reverse()
      .find((event) => event.kind === "rpc_request" && event.method === "sendUserTurn");
    expect(rpcRequest).toBeTruthy();

    const rpcError = events.find((event) => event.kind === "rpc_error");
    expect(rpcError).toBeTruthy();
    expect(rpcError.rpc_id).toBe(rpcRequest.rpc_id);
    expect(rpcError.req_id).toBe(trace.reqId);
    expect(rpcError.payload).toMatchObject({ truncated: true });
  });
});
