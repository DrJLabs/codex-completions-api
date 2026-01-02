import { describe, expect, it } from "vitest";
import { getClientIp, isLoopbackRequest } from "../../../src/lib/net.js";

describe("net helpers", () => {
  it("prefers req.ip when present", () => {
    const req = {
      ip: "203.0.113.10",
      connection: { remoteAddress: "127.0.0.1" },
    };
    expect(getClientIp(req)).toBe("203.0.113.10");
  });

  it("falls back to remoteAddress when req.ip missing", () => {
    const req = {
      connection: { remoteAddress: "10.0.0.1" },
    };
    expect(getClientIp(req)).toBe("10.0.0.1");
  });

  it("uses req.ip for loopback checks", () => {
    const req = {
      ip: "203.0.113.10",
      connection: { remoteAddress: "127.0.0.1" },
    };
    expect(isLoopbackRequest(req)).toBe(false);
  });

  it("treats loopback remoteAddress as loopback when req.ip missing", () => {
    const req = {
      connection: { remoteAddress: "::1" },
    };
    expect(isLoopbackRequest(req)).toBe(true);
  });
});
