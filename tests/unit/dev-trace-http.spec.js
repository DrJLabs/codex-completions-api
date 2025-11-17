import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../src/dev-logging.js", () => {
  return {
    appendProtoEvent: vi.fn(),
  };
});

const importTargets = async () => {
  const mod = await import("../../src/dev-trace/http.js");
  const logging = await import("../../src/dev-logging.js");
  return { logHttpRequest: mod.logHttpRequest, appendProtoEvent: logging.appendProtoEvent };
};

describe("logHttpRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redacts sensitive headers and emits http_ingress event", async () => {
    const { logHttpRequest, appendProtoEvent } = await importTargets();
    const req = {
      method: "POST",
      originalUrl: "/v1/chat/completions",
      headers: {
        Authorization: "Bearer secret",
        "X-Custom": "value",
      },
      body: { prompt: "hello" },
    };
    const res = { locals: {} };

    logHttpRequest({ req, res, route: "/v1/chat/completions", mode: "chat_stream" });

    expect(appendProtoEvent).toHaveBeenCalledTimes(1);
    const payload = appendProtoEvent.mock.calls[0][0];
    expect(payload.phase).toBe("http_ingress");
    expect(payload.kind).toBe("client_request");
    expect(payload.direction).toBe("inbound");
    expect(payload.headers.authorization).toBe("[REDACTED]");
    expect(payload.headers["x-custom"]).toBe("value");
    expect(payload.route).toBe("/v1/chat/completions");
    expect(payload.mode).toBe("chat_stream");
    expect(payload.req_id).toBeTruthy();
  });

  it("logs at most once per response instance", async () => {
    const { logHttpRequest, appendProtoEvent } = await importTargets();
    const req = {
      method: "POST",
      headers: {},
      body: {},
    };
    const res = { locals: {} };

    logHttpRequest({ req, res });
    logHttpRequest({ req, res });

    expect(appendProtoEvent).toHaveBeenCalledTimes(1);
  });
});
