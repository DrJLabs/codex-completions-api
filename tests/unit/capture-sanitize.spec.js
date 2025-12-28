import { describe, it, expect } from "vitest";
import { createCaptureSanitizers } from "../../src/lib/capture/sanitize.js";

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

  it("redacts auth URL fields even when key is marked safe", () => {
    const { sanitizeValue } = createCaptureSanitizers({
      safeStringKeys: new Set(["auth_url"]),
    });
    const payload = { auth_url: "https://example.com/login" };

    const result = sanitizeValue(payload);

    expect(result.auth_url).toBe("<redacted>");
  });
});
