import { describe, it, expect } from "vitest";
import {
  sanitizeMetadataTextSegment,
  extractMetadataFromPayload,
} from "../../src/lib/metadata-sanitizer.js";

describe("metadata sanitizer", () => {
  it("removes rollout metadata lines while keeping assistant text", () => {
    const metadata = {
      rollout_path: "/app/.codex-api/sessions/fake-rollout",
      session_id: "fake-session-123",
    };
    const chunk = [
      "Answer: Hello.",
      `rollout_path: ${metadata.rollout_path}`,
      `session_id: ${metadata.session_id}`,
    ].join("\n");
    const { text, removed } = sanitizeMetadataTextSegment(chunk, metadata);
    expect(text).toBe("Answer: Hello.");
    expect(removed).toHaveLength(2);
    expect(removed.map((entry) => entry.key)).toEqual(["rollout_path", "session_id"]);
  });

  it("keeps unrelated content untouched", () => {
    const narrative = "Path info: /tmp/rollout_path is just an example";
    const { text, removed } = sanitizeMetadataTextSegment(narrative);
    expect(text).toBe(narrative);
    expect(removed).toHaveLength(0);
  });

  it("strips JSON metadata blobs", () => {
    const jsonLine = 'metadata: {"rollout_path":"/tmp/demo","session_id":"s-1"}';
    const { text, removed } = sanitizeMetadataTextSegment(jsonLine, {});
    expect(text).toBe("");
    expect(removed).toHaveLength(2);
    expect(removed.map((entry) => entry.key).sort()).toEqual(["rollout_path", "session_id"]);
  });

  it("extracts metadata from nested payload structures", () => {
    const payload = {
      metadata: { rollout_path: "/tmp/a" },
      message: {
        metadata: { session_id: "session-123" },
        content: [
          { type: "text", text: "Hello" },
          { type: "meta", metadata: { rollout_path: "/tmp/b" } },
        ],
      },
    };
    const info = extractMetadataFromPayload(payload);
    expect(info).not.toBeNull();
    expect(info.metadata.rollout_path).toBe("/tmp/b");
    expect(info.metadata.session_id).toBe("session-123");
    expect(info.sources).toContain("message.content.metadata");
  });
});
