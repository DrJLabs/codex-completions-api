import { describe, expect, it, vi } from "vitest";
import {
  canonicalizeFinishReason,
  createFinishReasonTracker,
  extractFinishReasonFromMessage,
  resolveFinishReasonPriority,
  validateOptionalChatParams,
} from "../../../../src/handlers/chat/shared.js";

describe("chat shared helpers", () => {
  it("canonicalizes finish reasons and flags unknown values", () => {
    expect(canonicalizeFinishReason(null)).toEqual({
      reason: null,
      normalized: null,
      unknown: false,
    });
    expect(canonicalizeFinishReason("MAX_TOKENS").reason).toBe("length");
    expect(canonicalizeFinishReason("tool call").reason).toBe("tool_calls");
    expect(canonicalizeFinishReason("function execution").reason).toBe("function_call");
    expect(canonicalizeFinishReason("safety filter").reason).toBe("content_filter");

    const unknown = canonicalizeFinishReason("mystery");
    expect(unknown.reason).toBeNull();
    expect(unknown.unknown).toBe(true);
  });

  it("resolves finish reason priority with fallbacks", () => {
    expect(resolveFinishReasonPriority("provider")).toBe(1);
    expect(resolveFinishReasonPriority("unknown")).toBe(Number.POSITIVE_INFINITY);
    expect(resolveFinishReasonPriority(null)).toBe(Number.POSITIVE_INFINITY);
  });

  it("tracks finish reasons and adjusts for tool or function presence", () => {
    const onUnknown = vi.fn();
    const tracker = createFinishReasonTracker({ fallback: "stop", onUnknown });
    tracker.record("weird", "provider");
    tracker.record("stop", "finalizer");
    const resolvedTools = tracker.resolve({ hasToolCalls: true });
    expect(resolvedTools.reason).toBe("tool_calls");
    expect(resolvedTools.source).toBe("tool_presence");
    expect(onUnknown).toHaveBeenCalled();

    const resolvedFunctions = tracker.resolve({ hasFunctionCall: true });
    expect(resolvedFunctions.reason).toBe("function_call");
    expect(resolvedFunctions.source).toBe("function_presence");
  });

  it("extracts finish reasons from nested token metadata", () => {
    expect(
      extractFinishReasonFromMessage({
        token_count: { token_limit_reached: true },
      })
    ).toBe("length");
    expect(
      extractFinishReasonFromMessage({
        finish_reason: "stop",
      })
    ).toBe("stop");
    expect(
      extractFinishReasonFromMessage({
        token_limit_reached: true,
      })
    ).toBe("length");
  });

  it("validates optional chat params for response_format and seed", () => {
    const invalidLogprobs = validateOptionalChatParams({ logprobs: true });
    expect(invalidLogprobs.ok).toBe(false);
    expect(invalidLogprobs.error?.error?.param).toBe("logprobs");

    const invalidFormat = validateOptionalChatParams({
      response_format: "json_schema",
    });
    expect(invalidFormat.ok).toBe(false);

    const validSchema = validateOptionalChatParams(
      {
        response_format: { type: "json_schema", json_schema: { type: "object" } },
      },
      { allowJsonSchema: true }
    );
    expect(validSchema.ok).toBe(true);

    const invalidSchema = validateOptionalChatParams(
      {
        response_format: { type: "json_schema", json_schema: "nope" },
      },
      { allowJsonSchema: true }
    );
    expect(invalidSchema.ok).toBe(false);

    const invalidSeed = validateOptionalChatParams({ seed: "abc" });
    expect(invalidSeed.ok).toBe(false);
    expect(invalidSeed.error?.error?.param).toBe("seed");
  });
});
