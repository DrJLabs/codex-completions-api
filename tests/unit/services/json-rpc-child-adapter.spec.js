import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

let transport;

const logStructured = vi.fn();

vi.mock("../../../src/services/logging/schema.js", () => ({
  logStructured,
}));

vi.mock("../../../src/services/transport/index.js", async () => {
  const actual = await vi.importActual("../../../src/services/transport/index.js");
  return {
    ...actual,
    getJsonRpcTransport: () => transport,
  };
});

const ORIGINAL_AUTH_LOGIN_URL = process.env.PROXY_AUTH_LOGIN_URL;

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

const loadAdapter = async () => {
  vi.resetModules();
  const adapterModule = await import("../../../src/services/transport/child-adapter.js");
  const transportModule = await import("../../../src/services/transport/index.js");
  return {
    createJsonRpcChildAdapter: adapterModule.createJsonRpcChildAdapter,
    TransportError: transportModule.TransportError,
  };
};

afterEach(() => {
  transport = undefined;
  if (ORIGINAL_AUTH_LOGIN_URL === undefined) {
    delete process.env.PROXY_AUTH_LOGIN_URL;
  } else {
    process.env.PROXY_AUTH_LOGIN_URL = ORIGINAL_AUTH_LOGIN_URL;
  }
  vi.clearAllMocks();
  logStructured.mockClear();
});

describe("JsonRpcChildAdapter auth handling", () => {
  it("cancels context when error notification indicates 401 and willRetry is false", async () => {
    process.env.PROXY_AUTH_LOGIN_URL = "false";
    const { createJsonRpcChildAdapter, TransportError } = await loadAdapter();
    const emitter = new EventEmitter();
    let resolvePromise;
    const context = {
      emitter,
      promise: new Promise((resolve) => {
        resolvePromise = resolve;
      }),
    };

    transport = {
      createChatRequest: vi.fn(async () => context),
      sendUserMessage: vi.fn(),
      cancelContext: vi.fn(),
    };

    const adapter = createJsonRpcChildAdapter({
      reqId: "req-auth",
      timeoutMs: 1000,
      trace: { route: "/v1/responses", mode: "responses_stream" },
    });

    adapter.stdin.write(JSON.stringify({ prompt: "hello" }));
    await flushAsync();

    emitter.emit("notification", {
      method: "error",
      params: {
        error: {
          message: "unexpected status 401 Unauthorized: ",
          codexErrorInfo: "other",
        },
        willRetry: false,
      },
    });

    await flushAsync();

    expect(transport.cancelContext).toHaveBeenCalledTimes(1);
    expect(transport.cancelContext).toHaveBeenCalledWith(context, expect.any(TransportError));
    const errorArg = transport.cancelContext.mock.calls[0][1];
    expect(errorArg.code).toBe("auth_required");

    resolvePromise();
    await flushAsync();
  });

  it("attaches login details when auth login flag is enabled", async () => {
    process.env.PROXY_AUTH_LOGIN_URL = "true";
    const { createJsonRpcChildAdapter } = await loadAdapter();
    const emitter = new EventEmitter();
    let resolvePromise;
    const context = {
      emitter,
      promise: new Promise((resolve) => {
        resolvePromise = resolve;
      }),
    };

    transport = {
      createChatRequest: vi.fn(async () => context),
      sendUserMessage: vi.fn(),
      cancelContext: vi.fn(),
      getAuthLoginDetails: vi.fn(async () => ({
        auth_url: "https://example.test/login",
        login_id: "login-123",
      })),
    };

    const adapter = createJsonRpcChildAdapter({
      reqId: "req-auth-details",
      timeoutMs: 1000,
      trace: { route: "/v1/chat/completions", mode: "chat_stream" },
    });

    adapter.stdin.write(JSON.stringify({ prompt: "hello" }));
    await flushAsync();

    emitter.emit("notification", {
      method: "error",
      params: {
        codexErrorInfo: "unauthorized",
        willRetry: false,
      },
    });

    await flushAsync();
    await flushAsync();

    expect(transport.getAuthLoginDetails).toHaveBeenCalledTimes(1);
    expect(transport.cancelContext).toHaveBeenCalledTimes(1);
    const errorArg = transport.cancelContext.mock.calls[0][1];
    expect(errorArg.code).toBe("auth_required");
    expect(errorArg.details).toMatchObject({
      auth_url: "https://example.test/login",
      login_id: "login-123",
    });

    resolvePromise();
    await flushAsync();
  });

  it("redacts inline auth URLs in auth_required log entries", async () => {
    process.env.PROXY_AUTH_LOGIN_URL = "false";
    const { createJsonRpcChildAdapter } = await loadAdapter();
    const emitter = new EventEmitter();
    let resolvePromise;
    const context = {
      emitter,
      promise: new Promise((resolve) => {
        resolvePromise = resolve;
      }),
    };

    transport = {
      createChatRequest: vi.fn(async () => context),
      sendUserMessage: vi.fn(),
      cancelContext: vi.fn(),
    };

    const adapter = createJsonRpcChildAdapter({
      reqId: "req-auth-log",
      timeoutMs: 1000,
      trace: { route: "/v1/chat/completions", mode: "chat_stream" },
    });

    adapter.stdin.write(JSON.stringify({ prompt: "hello" }));
    await flushAsync();

    emitter.emit("notification", {
      method: "error",
      params: {
        codexErrorInfo: "unauthorized",
        error: {
          message: "unauthorized | login_url=https://example.test/oauth?x=1,y=2 | login_id=abc",
          codexErrorInfo: "other",
        },
        willRetry: false,
      },
    });

    await flushAsync();

    expect(logStructured).toHaveBeenCalled();
    const [, extras] = logStructured.mock.calls[0];
    expect(extras.error_message).toContain("login_url=[REDACTED]");
    expect(extras.error_message).not.toContain("example.test");
    expect(extras.error_message).not.toContain("y=2");

    resolvePromise();
    await flushAsync();
  });
});
