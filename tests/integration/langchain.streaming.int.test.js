import { describe, test, expect } from "vitest";
import { startServer, stopServer } from "./helpers.js";

let ChatOpenAI;
let langchainLoadError;

try {
  // eslint-disable-next-line n/no-missing-import, import/no-unresolved
  ({ ChatOpenAI } = await import("@langchain/openai"));
} catch (err) {
  langchainLoadError = err;
}

if (langchainLoadError) {
  console.warn(
    "[langchain-harness] Skipping LangChain streaming harness; install @langchain/openai to enable.",
    langchainLoadError?.code ?? langchainLoadError?.message ?? langchainLoadError
  );
}

const describeHarness = langchainLoadError ? describe.skip : describe;

const STREAM_CASES = [
  {
    label: "stop",
    env: {},
    expectedFinishReason: "stop",
    prompt: "LangChain harness stop",
  },
  {
    label: "length",
    env: { FAKE_CODEX_FINISH_REASON: "length" },
    expectedFinishReason: "length",
    prompt: "LangChain harness length",
  },
  {
    label: "tool_calls",
    env: { FAKE_CODEX_MODE: "tool_call" },
    expectedFinishReason: "tool_calls",
    prompt: "LangChain harness tool calls",
  },
  {
    label: "function_call",
    env: { FAKE_CODEX_MODE: "function_call" },
    expectedFinishReason: "function_call",
    prompt: "LangChain harness function call",
  },
  {
    label: "content_filter",
    env: { FAKE_CODEX_MODE: "content_filter" },
    expectedFinishReason: "content_filter",
    prompt: "LangChain harness content filter",
  },
];

const extractFinishReasonFromEvent = (event) => {
  if (!event || typeof event !== "object") return null;
  const { data } = event;
  if (!data || typeof data !== "object") return null;
  const chunk = data.chunk || data.delta || data;
  const choices = chunk?.choices || data.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const choice = choices[0];
    if (choice?.finish_reason) return choice.finish_reason;
    if (choice?.delta?.finish_reason) return choice.delta.finish_reason;
  }
  if (typeof chunk?.finish_reason === "string") return chunk.finish_reason;
  if (typeof data.finish_reason === "string") return data.finish_reason;
  return null;
};

const extractUsageFromEvent = (event) => {
  if (!event || typeof event !== "object") return null;
  const { data } = event;
  if (data?.usage && typeof data.usage === "object") return data.usage;
  if (data?.chunk?.usage && typeof data.chunk.usage === "object") return data.chunk.usage;
  return null;
};

describeHarness("LangChain streaming harness", () => {
  for (const { label, env, expectedFinishReason, prompt } of STREAM_CASES) {
    test(`streams finish_reason ${label}`, async () => {
      const serverCtx = await startServer({ CODEX_BIN: "scripts/fake-codex-jsonrpc.js", ...env });
      try {
        const baseURL = `http://127.0.0.1:${serverCtx.PORT}/v1`;
        const client = new ChatOpenAI({
          apiKey: "test-sk-ci",
          model: "codex-5",
          configuration: { baseURL },
          streaming: true,
        });

        if (typeof client.stream !== "function") {
          console.warn("[langchain-harness] ChatOpenAI.stream unavailable; skipping assertions.");
          return;
        }

        const stream = await client.stream([{ role: "user", content: prompt }], {
          streamUsage: true,
        });

        const observedReasons = [];
        const order = [];
        let usageChunk = null;
        for await (const event of stream) {
          const reason = extractFinishReasonFromEvent(event);
          if (reason) {
            observedReasons.push(reason);
            order.push("finish");
          }
          const usage = extractUsageFromEvent(event);
          if (usage) {
            usageChunk = usage;
            order.push("usage");
          }
        }

        expect(observedReasons).toContain(expectedFinishReason);
        if (usageChunk) {
          expect(order.slice(-2)).toEqual(["finish", "usage"]);
          expect(Number.isFinite(usageChunk.prompt_tokens)).toBe(true);
        } else {
          console.warn(
            "[langchain-harness] No usage chunk observed; verify streamUsage support in installed LangChain version."
          );
        }
      } finally {
        await stopServer(serverCtx.child);
      }
    });
  }
});
