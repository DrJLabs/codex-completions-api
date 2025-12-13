import { describe, expect, test, vi } from "vitest";
import {
  detectIngressMarkers,
  buildIngressGuardrailContent,
  maybeInjectIngressGuardrail,
} from "../../../src/lib/ingress-guardrail.js";

describe("ingress guardrail helpers", () => {
  test("detectIngressMarkers finds recent_conversations + tool transcripts", () => {
    const markers = detectIngressMarkers([
      {
        role: "user",
        content:
          "<recent_conversations>...</recent_conversations>\n<use_tool>noop</use_tool>\nTool 'webSearch' result: []",
      },
    ]);
    expect(markers).toEqual({
      has_recent_conversations_tag: true,
      has_use_tool_tag: true,
      has_tool_result_marker: true,
    });
  });

  test("buildIngressGuardrailContent includes tag and signal list", () => {
    const content = buildIngressGuardrailContent({
      markers: {
        has_recent_conversations_tag: true,
        has_use_tool_tag: false,
        has_tool_result_marker: true,
      },
    });
    expect(content).toContain("[proxy][ingress_guardrail_v1]");
    expect(content).toContain("Signals detected:");
    expect(content).toContain("recent_conversations");
    expect(content).toContain("tool_result");
  });

  test("maybeInjectIngressGuardrail prepends a system message once", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const baseMessages = [
        { role: "user", content: "<recent_conversations>hi</recent_conversations>\nSay hello." },
      ];
      const res = { locals: { req_id: "req_test", routeOverride: "/v1/chat/completions" } };
      const req = { headers: { "user-agent": "test" } };

      const first = maybeInjectIngressGuardrail({
        req,
        res,
        messages: baseMessages,
        enabled: true,
        route: "/v1/chat/completions",
        mode: "chat_nonstream",
        endpointMode: "chat_completions",
      });
      expect(first.injected).toBe(true);
      expect(first.messages[0]).toMatchObject({ role: "system" });
      expect(first.messages[0].content).toContain("[proxy][ingress_guardrail_v1]");

      const second = maybeInjectIngressGuardrail({
        req,
        res,
        messages: first.messages,
        enabled: true,
        route: "/v1/chat/completions",
        mode: "chat_nonstream",
        endpointMode: "chat_completions",
      });
      expect(second.injected).toBe(false);
      expect(second.messages).toHaveLength(first.messages.length);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
