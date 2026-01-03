import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { wireStreamTransport } from "../../../../src/handlers/chat/stream-transport.js";

describe("stream transport", () => {
  it("forwards delta events to runtime", () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    const runtime = { handleDelta: vi.fn() };

    wireStreamTransport({ child, runtime });

    child.stdout.emit(
      "data",
      JSON.stringify({ type: "agent_message_delta", msg: { delta: "hi" } })
    );

    expect(runtime.handleDelta).toHaveBeenCalledWith({
      choiceIndex: 0,
      delta: { delta: "hi" },
    });
  });
});
