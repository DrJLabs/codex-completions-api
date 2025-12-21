import { describe, expect, test } from "vitest";
import { detectCopilotRequest } from "../../../src/lib/copilot-detect.js";

describe("copilot request detection", () => {
  test("flags high confidence when x-copilot-trace-id is present", () => {
    const result = detectCopilotRequest({
      headers: { "x-copilot-trace-id": "copilot-123" },
    });
    expect(result.copilot_detected).toBe(true);
    expect(result.copilot_detect_tier).toBe("high");
    expect(result.copilot_detect_reasons).toContain("header_x_copilot_trace_id");
  });

  test("flags high confidence when recent_conversations marker is present", () => {
    const result = detectCopilotRequest({
      headers: {},
      markers: { has_recent_conversations_tag: true },
    });
    expect(result.copilot_detected).toBe(true);
    expect(result.copilot_detect_tier).toBe("high");
    expect(result.copilot_detect_reasons).toContain("marker_recent_conversations");
  });

  test("flags high confidence when saved_memories marker is present", () => {
    const result = detectCopilotRequest({
      headers: {},
      markers: { has_saved_memories_tag: true },
    });
    expect(result.copilot_detected).toBe(true);
    expect(result.copilot_detect_tier).toBe("high");
    expect(result.copilot_detect_reasons).toContain("marker_saved_memories");
  });

  test("flags high confidence when OpenRouter headers are present", () => {
    const result = detectCopilotRequest({
      headers: {
        "http-referer": "https://obsidiancopilot.com",
        "x-title": "Obsidian Copilot",
      },
    });
    expect(result.copilot_detected).toBe(true);
    expect(result.copilot_detect_tier).toBe("high");
    expect(result.copilot_detect_reasons).toContain("header_openrouter_pair");
  });

  test("flags suspected when UA is Copilot and use_tool marker present", () => {
    const result = detectCopilotRequest({
      headers: { "user-agent": "obsidian/1.9.7" },
      markers: { has_use_tool_tag: true },
    });
    expect(result.copilot_detected).toBe(true);
    expect(result.copilot_detect_tier).toBe("suspected");
    expect(result.copilot_detect_reasons).toContain("ua_obsidian");
    expect(result.copilot_detect_reasons).toContain("marker_use_tool");
  });

  test("does not flag high confidence for UA only", () => {
    const result = detectCopilotRequest({
      headers: { "user-agent": "obsidian/1.9.7" },
    });
    expect(result.copilot_detected).toBe(false);
    expect(result.copilot_detect_tier).toBe(null);
  });
});
