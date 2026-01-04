import { describe, expect, it, vi } from "vitest";
import { createStreamMetadataSanitizer } from "../../../../src/handlers/chat/stream-metadata-sanitizer.js";

describe("stream metadata sanitizer", () => {
  it("buffers, sanitizes, and emits segments", () => {
    const appendContentSegment = vi.fn();
    const appendProtoEvent = vi.fn();
    const sanitizer = createStreamMetadataSanitizer({
      sanitizeMetadata: true,
      reqId: "req-1",
      route: "/v1/chat/completions",
      mode: "chat_stream",
      appendProtoEvent,
      logSanitizerToggle: vi.fn(),
      metadataKeys: () => ["customer.id"],
      normalizeMetadataKey: (key) => key,
      sanitizeMetadataTextSegment: (segment) => ({ text: segment, removed: [] }),
      appendContentSegment,
      scheduleStopAfterTools: vi.fn(),
    });

    sanitizer.enqueueSanitizedSegment(
      "hello\n",
      { metadata: { "customer.id": "1" }, sources: ["request"] },
      { stage: "agent_message_delta", eventType: "agent_message_delta" },
      { choiceIndex: 0 }
    );

    expect(appendContentSegment).toHaveBeenCalledWith("hello\n", { choiceIndex: 0 });
    const summary = sanitizer.getSummaryData();
    expect(summary.keys).toContain("customer.id");
  });

  it("records sanitized removals", () => {
    const appendProtoEvent = vi.fn();
    const sanitizer = createStreamMetadataSanitizer({
      sanitizeMetadata: true,
      reqId: "req-1",
      route: "/v1/chat/completions",
      mode: "chat_stream",
      appendProtoEvent,
      logSanitizerToggle: vi.fn(),
      metadataKeys: () => [],
      normalizeMetadataKey: (key) => key,
      sanitizeMetadataTextSegment: (segment) => ({
        text: segment,
        removed: [{ key: "user.id", raw: "user.id:2" }],
      }),
      appendContentSegment: vi.fn(),
      scheduleStopAfterTools: vi.fn(),
    });

    sanitizer.recordSanitizedMetadata({
      stage: "agent_message_delta",
      eventType: "agent_message_delta",
      metadata: { "user.id": "2" },
      removed: [{ key: "user.id", raw: "user.id:2" }],
      sources: ["request"],
    });

    const summary = sanitizer.getSummaryData();
    expect(summary.count).toBe(1);
    expect(appendProtoEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "metadata_sanitizer" })
    );
  });
});
