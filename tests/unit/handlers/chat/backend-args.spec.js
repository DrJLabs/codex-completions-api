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
      effectiveModel: "gpt-5.2",
      FORCE_PROVIDER: "chatgpt",
      reasoningEffort: "low",
      allowEffort: new Set(["low", "medium", "high", "xhigh"]),
      enableParallelTools: true,
    });
    const configArgs = getConfigArgs(args);

    expect(configArgs).toEqual([
      'model="gpt-5.2"',
      'preferred_auth_method="chatgpt"',
      'sandbox_mode="read-only"',
      'model_provider="chatgpt"',
      "parallel_tool_calls=true",
      'model_reasoning_effort="low"',
      'reasoning.effort="low"',
    ]);
  });

  it("omits reasoning overrides when effort is not allowed", () => {
    const args = buildAppServerArgs({
      SANDBOX_MODE: "read-only",
      effectiveModel: "gpt-5.2",
      FORCE_PROVIDER: "",
      reasoningEffort: "high",
      allowEffort: new Set(["low", "medium"]),
      enableParallelTools: false,
    });
    const configArgs = getConfigArgs(args);

    expect(configArgs).toEqual([
      'model="gpt-5.2"',
      'preferred_auth_method="chatgpt"',
      'sandbox_mode="read-only"',
    ]);
  });
});
