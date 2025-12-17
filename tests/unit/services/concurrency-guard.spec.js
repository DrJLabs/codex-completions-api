import { describe, expect, test, beforeEach, vi } from "vitest";
import {
  sseConcurrencyGuard,
  guardSnapshot,
  setupStreamGuard,
  applyGuardHeaders,
} from "../../../src/services/concurrency-guard.js";

beforeEach(() => {
  sseConcurrencyGuard.releaseAll();
  vi.restoreAllMocks();
});

describe("ConcurrencySemaphore and guard helpers", () => {
  test("acquire increments and release decrements, clamped at zero", () => {
    const token1 = sseConcurrencyGuard.tryAcquire(2);
    expect(token1.acquired).toBe(true);
    expect(guardSnapshot()).toBe(1);

    const token2 = sseConcurrencyGuard.tryAcquire(2);
    expect(token2.acquired).toBe(true);
    expect(guardSnapshot()).toBe(2);

    token1.release();
    expect(guardSnapshot()).toBe(1);

    token1.release();
    expect(guardSnapshot()).toBe(1);

    token2.release();
    expect(guardSnapshot()).toBe(0);

    token2.release();
    expect(guardSnapshot()).toBe(0);
  });

  test("rejected acquire returns token with headers when test endpoints enabled", () => {
    const res = { set: vi.fn() };
    const send429 = vi.fn();
    // Fill guard to limit 1
    const first = setupStreamGuard({
      res,
      reqId: "req-1",
      route: "/v1/chat",
      maxConc: 1,
      testEndpointsEnabled: true,
      send429,
    });
    expect(first.acquired).toBe(true);
    expect(res.set).not.toHaveBeenCalled();

    res.set.mockClear();
    const second = setupStreamGuard({
      res,
      reqId: "req-2",
      route: "/v1/chat",
      maxConc: 1,
      testEndpointsEnabled: true,
      send429,
    });
    expect(second.acquired).toBe(false);
    expect(send429).toHaveBeenCalledTimes(1);
    expect(res.set).toHaveBeenCalledWith("X-Conc-Before", "1");
    expect(res.set).toHaveBeenCalledWith("X-Conc-After", "1");
    expect(res.set).toHaveBeenCalledWith("X-Conc-Limit", "1");

    first.release();
    expect(guardSnapshot()).toBe(0);
  });

  test("headers are not applied when test endpoints disabled", () => {
    const res = { set: vi.fn() };
    const send429 = vi.fn();
    const token = sseConcurrencyGuard.tryAcquire(1);
    expect(token.acquired).toBe(true);

    const rejected = setupStreamGuard({
      res,
      reqId: "req-3",
      route: "/v1/chat",
      maxConc: 1,
      testEndpointsEnabled: false,
      send429,
    });
    expect(rejected.acquired).toBe(false);
    expect(send429).toHaveBeenCalledTimes(1);
    expect(res.set).not.toHaveBeenCalled();

    applyGuardHeaders(res, token, false);
    expect(res.set).not.toHaveBeenCalled();

    token.release();
    expect(guardSnapshot()).toBe(0);
  });
});
