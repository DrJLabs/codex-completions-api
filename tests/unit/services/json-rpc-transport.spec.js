import { PassThrough } from "node:stream";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

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

const { getJsonRpcTransport, resetJsonRpcTransport } = await import(
  "../../../src/services/transport/index.js"
);
const { __setChild } = await import("../../../src/services/worker/supervisor.js");

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
});

afterEach(() => {
  const child = state.child;
  if (child?.destroy) child.destroy();
  __setChild(null);
  resetJsonRpcTransport();
  vi.useRealTimers();
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
