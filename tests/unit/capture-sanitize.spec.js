import { describe, it, expect } from "vitest";
import {
  createCaptureSanitizers,
  isPlainObject,
  sanitizeCaptureId,
} from "../../src/lib/capture/sanitize.js";

describe("capture sanitize helpers", () => {
  it("redacts inline auth URLs even for safe string keys", () => {
    const { sanitizeValue } = createCaptureSanitizers({
      safeStringKeys: new Set(["code"]),
    });
    const payload = {
      error: {
        code: "invalid_api_key | login_url=https://example.com/oauth?x=1 | login_id=abc",
      },
    };

    const result = sanitizeValue(payload);

    expect(result.error.code).toContain("login_url=<redacted>");
    expect(result.error.code).toContain("login_id=<redacted>");
    expect(result.error.code).not.toContain("https://example.com/oauth");
  });

  it("redacts inline auth URLs that contain commas", () => {
    const { sanitizeValue } = createCaptureSanitizers({
      safeStringKeys: new Set(["code", "message"]),
    });
    const payload = {
      error: {
        code: "invalid_api_key | login_url=https://example.com/oauth?x=1,y=2 | login_id=abc",
        message: "unauthorized | login_url=https://example.com/oauth?x=1,y=2 | login_id=abc",
      },
    };

    const result = sanitizeValue(payload);

    expect(result.error.code).toContain("login_url=<redacted>");
    expect(result.error.message).toContain("login_url=<redacted>");
    expect(result.error.code).not.toContain("example.com");
    expect(result.error.message).not.toContain("example.com");
    expect(result.error.code).not.toContain("y=2");
    expect(result.error.message).not.toContain("y=2");
  });

  it("redacts auth URL fields even when key is marked safe", () => {
    const { sanitizeValue } = createCaptureSanitizers({
      safeStringKeys: new Set(["auth_url"]),
    });
    const payload = { auth_url: "https://example.com/login" };

    const result = sanitizeValue(payload);

    expect(result.auth_url).toBe("<redacted>");
  });

  it("normalizes capture ids and trims invalid characters", () => {
    expect(sanitizeCaptureId("  Hello**World  ")).toBe("hello-world");
    expect(sanitizeCaptureId("")).toBe("");
    expect(sanitizeCaptureId("a".repeat(200))).toHaveLength(80);
  });

  it("identifies plain objects only", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
  });

  it("sanitizes nested values and metadata entries", () => {
    const { sanitizeValue } = createCaptureSanitizers({
      safeStringKeys: new Set(["message"]),
    });

    const payload = {
      message: "ok",
      count: 2,
      flag: true,
      metadata: { token: "secret", nested: { value: "oops" } },
      nested: { value: "secret" },
    };

    const result = sanitizeValue(payload);

    expect(result.message).toBe("ok");
    expect(result.count).toBe(2);
    expect(result.flag).toBe(true);
    expect(result.metadata).toEqual({ token: "<redacted>", nested: "<redacted>" });
    expect(result.nested.value).toBe("<redacted>");
  });

  it("sanitizes headers with allowlists and safe keys", () => {
    const { sanitizeHeaders } = createCaptureSanitizers();

    const result = sanitizeHeaders({
      "User-Agent": "Agent\r\nName",
      "X-Request-Id": "request-123",
      "X-Proxy-Trace-Id": "trace-456",
      Accept: ["text/plain", "text/html"],
      Authorization: "Bearer 123",
      "X-Not-Allowed": "nope",
    });

    expect(result["user-agent"]).toBe("Agent Name");
    expect(result["x-request-id"]).toBe("<redacted>");
    expect(result["x-proxy-trace-id"]).toBe("trace-456");
    expect(result.accept).toEqual(["text/plain", "text/html"]);
    expect(result.authorization).toBeUndefined();
    expect(result["x-not-allowed"]).toBeUndefined();
  });

  it("sanitizes raw headers but keeps non-secret values", () => {
    const { sanitizeHeadersRaw } = createCaptureSanitizers();

    const result = sanitizeHeadersRaw({
      Authorization: "Bearer 123",
      "X-Proxy-Api-Key": "secret",
      "X-Request-Id": "request-123",
    });

    expect(result.authorization).toBe("<redacted>");
    expect(result["x-proxy-api-key"]).toBe("<redacted>");
    expect(result["x-request-id"]).toBe("request-123");
  });
});
