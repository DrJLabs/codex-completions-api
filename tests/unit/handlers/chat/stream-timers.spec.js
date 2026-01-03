import { describe, expect, it, vi } from "vitest";
import { createStreamTimers } from "../../../../src/handlers/chat/stream-timers.js";

describe("stream timers", () => {
  it("invokes onIdle when idle timer fires", () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const timers = createStreamTimers({ idleMs: 1, onIdle });

    timers.startIdleTimer();
    vi.runAllTimers();

    expect(onIdle).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
