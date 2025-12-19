import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { sendSSE } from "../../../src/services/sse.js";

describe("sendSSE backpressure", () => {
  it("queues writes until drain when res.write returns false", async () => {
    const res = new EventEmitter();
    res.locals = {};
    let allowWrite = false;
    res.write = vi.fn(() => allowWrite);
    res.flush = vi.fn();

    sendSSE(res, { first: true });
    sendSSE(res, { second: true });

    expect(res.write).toHaveBeenCalledTimes(1);

    allowWrite = true;
    res.emit("drain");
    await new Promise((resolve) => setImmediate(resolve));

    expect(res.write).toHaveBeenCalledTimes(2);
  });
});
