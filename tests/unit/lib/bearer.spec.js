import { describe, expect, it } from "vitest";
import { bearerToken, bearerTokenFromAuthHeader } from "../../../src/lib/bearer.js";

describe("bearer token helpers", () => {
  it("returns empty string for missing or invalid headers", () => {
    expect(bearerTokenFromAuthHeader()).toBe("");
    expect(bearerTokenFromAuthHeader(null)).toBe("");
    expect(bearerTokenFromAuthHeader(123)).toBe("");
    expect(bearerTokenFromAuthHeader("")).toBe("");
    expect(bearerTokenFromAuthHeader("Token abc")).toBe("");
  });

  it("parses bearer tokens case-insensitively and trims", () => {
    expect(bearerTokenFromAuthHeader("Bearer abc")).toBe("abc");
    expect(bearerTokenFromAuthHeader("bearer abc")).toBe("abc");
    expect(bearerTokenFromAuthHeader("BEARER   abc  ")).toBe("abc");
  });

  it("reads bearer token from request headers", () => {
    const req = { headers: { authorization: "Bearer req-token" } };
    expect(bearerToken(req)).toBe("req-token");
    expect(bearerToken({ headers: {} })).toBe("");
  });
});
