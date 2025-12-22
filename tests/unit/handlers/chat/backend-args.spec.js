import { describe, expect, it } from "vitest";
import { buildAppServerArgs } from "../../../../src/handlers/chat/shared.js";

describe("buildAppServerArgs", () => {
  const getConfigArgs = (args) =>
    args.reduce((acc, arg, i) => {
      if (i > 0 && args[i - 1] === "-c") {
        acc.push(arg);
      }
      return acc;
    }, []);

  it("includes CLI config overrides for app-server launches", () => {
    const args = buildAppServerArgs({
      SANDBOX_MODE: "read-only",
      effectiveModel: "gpt-5",
      FORCE_PROVIDER: "chatgpt",
      reasoningEffort: "low",
      allowEffort: new Set(["low", "medium", "high", "minimal"]),
      enableParallelTools: true,
    });
    const configArgs = getConfigArgs(args);

    expect(configArgs).toContain('model="gpt-5"');
    expect(configArgs).toContain('preferred_auth_method="chatgpt"');
    expect(configArgs).toContain('sandbox_mode="read-only"');
    expect(configArgs).toContain('model_provider="chatgpt"');
    expect(configArgs).toContain("parallel_tool_calls=true");
    expect(configArgs).toContain('model_reasoning_effort="low"');
    expect(configArgs).toContain('reasoning.effort="low"');
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
    const configArgs = getConfigArgs(args);

    expect(configArgs).not.toContain('model_reasoning_effort="high"');
    expect(configArgs).not.toContain('reasoning.effort="high"');
  });
});
