import { describe, expect, it } from "vitest";
import {
  resolveChatCopilotDetection,
  resolveOutputMode,
} from "../../../../src/handlers/chat/shared.js";

describe("chat output mode for Copilot", () => {
  it("forces obsidian-xml for high-confidence markers", () => {
    const messages = [
      {
        role: "user",
        content: "<recent_conversations>...</recent_conversations>",
      },
    ];
    const { copilotDetection } = resolveChatCopilotDetection({
      headers: {},
      messages,
    });
    const result = resolveOutputMode({
      headerValue: null,
      defaultValue: "openai-json",
      copilotDefault: "obsidian-xml",
      copilotDetection,
    });
    expect(copilotDetection.copilot_detect_tier).toBe("high");
    expect(result).toBe("obsidian-xml");
  });

  it("does not force obsidian-xml for suspected detection", () => {
    const messages = [
      {
        role: "user",
        content: "<use_tool>noop</use_tool>",
      },
    ];
    const { copilotDetection } = resolveChatCopilotDetection({
      headers: { "user-agent": "obsidian/1.9.7" },
      messages,
    });
    const result = resolveOutputMode({
      headerValue: null,
      defaultValue: "openai-json",
      copilotDefault: "obsidian-xml",
      copilotDetection,
    });
    expect(copilotDetection.copilot_detect_tier).toBe("suspected");
    expect(result).toBe("openai-json");
  });

  it("respects explicit output mode header", () => {
    const { copilotDetection } = resolveChatCopilotDetection({
      headers: { "x-copilot-trace-id": "copilot-123" },
      messages: [],
    });
    const result = resolveOutputMode({
      headerValue: "openai-json",
      defaultValue: "obsidian-xml",
      copilotDefault: "obsidian-xml",
      copilotDetection,
    });
    expect(copilotDetection.copilot_detect_tier).toBe("high");
    expect(result).toBe("openai-json");
  });

  it("uses provided markers when available", () => {
    const { copilotDetection } = resolveChatCopilotDetection({
      headers: {},
      messages: [],
      markers: { has_saved_memories_tag: true },
    });
    expect(copilotDetection.copilot_detect_tier).toBe("high");
    expect(copilotDetection.copilot_detect_reasons).toContain("marker_saved_memories");
  });
});
