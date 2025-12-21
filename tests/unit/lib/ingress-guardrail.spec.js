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
          "<recent_conversations>...</recent_conversations>\n<saved_memories>...</saved_memories>\n<use_tool>noop</use_tool>\nTool 'webSearch' result: []",
      },
    ]);
    expect(markers).toEqual({
      has_recent_conversations_tag: true,
      has_saved_memories_tag: true,
      has_use_tool_tag: true,
      has_tool_result_marker: true,
    });
  });

  test("buildIngressGuardrailContent includes tag and signal list", () => {
    const content = buildIngressGuardrailContent({
      markers: {
        has_recent_conversations_tag: true,
        has_saved_memories_tag: true,
        has_use_tool_tag: false,
        has_tool_result_marker: true,
      },
    });
    expect(content).toContain("[proxy][ingress_guardrail_v1]");
    expect(content).toContain("Signals detected:");
    expect(content).toContain("recent_conversations");
    expect(content).toContain("saved_memories");
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

  test("maybeInjectIngressGuardrail injects when saved memories are present", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const baseMessages = [
        { role: "user", content: "<saved_memories>hi</saved_memories>\nSay hello." },
      ];
      const res = { locals: { req_id: "req_test", routeOverride: "/v1/chat/completions" } };
      const req = { headers: { "user-agent": "test" } };

      const result = maybeInjectIngressGuardrail({
        req,
        res,
        messages: baseMessages,
        enabled: true,
        route: "/v1/chat/completions",
        mode: "chat_nonstream",
        endpointMode: "chat_completions",
      });
      expect(result.injected).toBe(true);
      expect(result.messages[0]).toMatchObject({ role: "system" });
    } finally {
      consoleSpy.mockRestore();
    }
  });

  test("maybeInjectIngressGuardrail does not treat tag in user content as existing guardrail", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const baseMessages = [
        {
          role: "user",
          content:
            "[proxy][ingress_guardrail_v1]\n<recent_conversations>hi</recent_conversations>\nSay hello.",
        },
      ];
      const res = { locals: { req_id: "req_test", routeOverride: "/v1/chat/completions" } };
      const req = { headers: { "user-agent": "test" } };

      const result = maybeInjectIngressGuardrail({
        req,
        res,
        messages: baseMessages,
        enabled: true,
        route: "/v1/chat/completions",
        mode: "chat_nonstream",
        endpointMode: "chat_completions",
      });
      expect(result.injected).toBe(true);
      expect(result.messages[0]).toMatchObject({ role: "system" });
    } finally {
      consoleSpy.mockRestore();
    }
  });

  test("maybeInjectIngressGuardrail continues when guardrail logging fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const prevEnv = process.env.PROXY_ENV;
    process.env.PROXY_ENV = "dev";

    vi.resetModules();
    vi.doMock("../../../src/services/logging/schema.js", () => ({
      logStructured() {
        throw new Error("boom");
      },
    }));

    try {
      const { maybeInjectIngressGuardrail: inject } = await import(
        "../../../src/lib/ingress-guardrail.js"
      );
      const baseMessages = [
        { role: "user", content: "<recent_conversations>hi</recent_conversations>\nSay hello." },
      ];
      const res = { locals: { req_id: "req_test", routeOverride: "/v1/chat/completions" } };
      const req = { headers: { "user-agent": "test" } };

      const result = inject({
        req,
        res,
        messages: baseMessages,
        enabled: true,
        route: "/v1/chat/completions",
        mode: "chat_nonstream",
        endpointMode: "chat_completions",
      });
      expect(result.injected).toBe(true);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      vi.doUnmock("../../../src/services/logging/schema.js");
      process.env.PROXY_ENV = prevEnv;
      warnSpy.mockRestore();
      logSpy.mockRestore();
    }
  });
});
