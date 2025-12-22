import { describe, expect, it } from "vitest";
import { buildAppServerArgs } from "../../../../src/handlers/chat/shared.js";

describe("buildAppServerArgs", () => {
  it("includes CLI config overrides for app-server launches", () => {
    const args = buildAppServerArgs({
      SANDBOX_MODE: "read-only",
      effectiveModel: "gpt-5",
      FORCE_PROVIDER: "chatgpt",
      reasoningEffort: "low",
      allowEffort: new Set(["low", "medium", "high", "minimal"]),
      enableParallelTools: true,
    });
    const joined = args.join(" ");

    expect(joined).toContain('model="gpt-5"');
    expect(joined).toContain('preferred_auth_method="chatgpt"');
    expect(joined).toContain('sandbox_mode="read-only"');
    expect(joined).toContain('model_provider="chatgpt"');
    expect(joined).toContain("parallel_tool_calls=true");
    expect(joined).toContain('model_reasoning_effort="low"');
    expect(joined).toContain('reasoning.effort="low"');
  });

  it("omits reasoning overrides when effort is not allowed", () => {
    const args = buildAppServerArgs({
      SANDBOX_MODE: "read-only",
      effectiveModel: "gpt-5",
      FORCE_PROVIDER: "",
      reasoningEffort: "high",
      allowEffort: new Set(["low", "medium"]),
      enableParallelTools: false,
    });
    const joined = args.join(" ");

    expect(joined).not.toContain('model_reasoning_effort="high"');
    expect(joined).not.toContain('reasoning.effort="high"');
  });
});
