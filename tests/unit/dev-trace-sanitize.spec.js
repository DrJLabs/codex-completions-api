import { describe, it, expect, vi } from "vitest";

const loadSanitize = async (limit = 64) => {
  vi.resetModules();
  if (limit !== undefined) {
    process.env.PROXY_TRACE_BODY_LIMIT = String(limit);
  } else {
    delete process.env.PROXY_TRACE_BODY_LIMIT;
  }
  const mod = await import("../../src/dev-trace/sanitize.js");
  delete process.env.PROXY_TRACE_BODY_LIMIT;
  return mod;
};

describe("dev-trace sanitize helpers", () => {
  it("redacts sensitive headers and preserves safe ones", async () => {
    const { sanitizeHeaders } = await loadSanitize();
    const headers = sanitizeHeaders({
      Authorization: "Bearer secret",
      COOKIE: "session",
      "X-Client": "value",
      Accept: ["application/json", 123],
    });
    expect(headers.authorization).toBe("[REDACTED]");
    expect(headers.cookie).toBe("[REDACTED]");
    expect(headers["x-client"]).toBe("value");
    expect(headers.accept).toEqual(["application/json", "123"]);
  });

  it("truncates oversized JSON bodies and exposes preview metadata", async () => {
    const { sanitizeBody } = await loadSanitize(32);
    const payload = { message: "x".repeat(80), nested: { flag: true } };
    const result = sanitizeBody(payload);
    expect(result).toMatchObject({ truncated: true });
    expect(result.preview.length).toBeLessThanOrEqual(32);
  });

  it("handles strings and buffers by respecting the limit", async () => {
    const { sanitizeBody } = await loadSanitize(16);
    const textResult = sanitizeBody("0123456789abcdefXYZ");
    expect(textResult.endsWith("…<truncated>")).toBe(true);

    const buf = Buffer.from("buffer-payload-value");
    const bufResult = sanitizeBody(buf);
    expect(bufResult.endsWith("…<truncated>")).toBe(true);
  });

  it("sanitizes RPC payloads via sanitizeRpcPayload", async () => {
    const { sanitizeRpcPayload } = await loadSanitize(20);
    const rpcResult = sanitizeRpcPayload({ tool_calls: [{ args: "a".repeat(100) }] });
    expect(rpcResult).toMatchObject({ truncated: true });
  });
});
