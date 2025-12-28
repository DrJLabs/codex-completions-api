import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

let transport;

vi.mock("../../../src/services/transport/index.js", async () => {
  const actual = await vi.importActual("../../../src/services/transport/index.js");
  return {
    ...actual,
    getJsonRpcTransport: () => transport,
  };
});

const { createJsonRpcChildAdapter } = await import(
  "../../../src/services/transport/child-adapter.js"
);
const { TransportError } = await import("../../../src/services/transport/index.js");

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  transport = undefined;
  vi.clearAllMocks();
});

describe("JsonRpcChildAdapter auth handling", () => {
  it("cancels context when error notification indicates 401 and willRetry is false", async () => {
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
});
