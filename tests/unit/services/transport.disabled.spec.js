import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/services/backend-mode.js", () => ({
  isAppServerMode: vi.fn(() => false),
}));

vi.mock("../../../src/services/worker/supervisor.js", () => ({
  ensureWorkerSupervisor: vi.fn(),
  getWorkerSupervisor: vi.fn(),
  getWorkerChildProcess: vi.fn(),
  onWorkerSupervisorEvent: vi.fn(() => () => {}),
}));

describe("transport guardrails", () => {
  it("throws when app-server mode is disabled", async () => {
    const { getJsonRpcTransport, TransportError } = await import(
      "../../../src/services/transport/index.js"
    );

    expect(() => getJsonRpcTransport()).toThrow(TransportError);
  });
});
