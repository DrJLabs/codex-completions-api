#!/usr/bin/env node
/*
  Minimal Codex "proto" shim for tests.
  Emits JSONL events the proxy expects, supporting both streaming and non-streaming flows.

  Behavior:
  - Reads one JSON line from stdin representing a user_input submission
  - Emits a small sequence of protocol events:
    session_configured -> task_started -> agent_message_delta/agent_message -> token_count -> task_complete
*/

import { setTimeout as delay } from "node:timers/promises";

const write = (obj) => {
  try {
    process.stdout.write(JSON.stringify(obj) + "\n");
  } catch {}
};

const main = async () => {
  let submission = "";
  try {
    // Read first line from stdin
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) {
      submission += chunk;
      const idx = submission.indexOf("\n");
      if (idx >= 0) {
        submission = submission.slice(0, idx);
        break;
      }
    }
  } catch {}

  // Emit a deterministic short response
  write({ type: "session_configured" });
  write({ type: "task_started" });
  await delay(10);
  write({ type: "agent_reasoning_delta", msg: { delta: "…" } });
  await delay(10);

  const scenario = String(process.env.FAKE_CODEX_MODE || "").toLowerCase();
  const requestedFinish = String(process.env.FAKE_CODEX_FINISH_REASON || "stop")
    .trim()
    .toLowerCase();
  let finishReason = "stop";
  if (["length", "max_tokens", "token_limit"].includes(requestedFinish)) {
    finishReason = "length";
  }
  if (scenario === "content_filter") {
    finishReason = "content_filter";
  } else if (scenario === "function_call") {
    finishReason = finishReason === "length" ? "length" : "function_call";
  }

  const parallelToolCalls = !/^false$/i.test(String(process.env.FAKE_CODEX_PARALLEL || "true"));
  const toolCalls =
    scenario === "tool_call"
      ? [
          {
            id: "tool_fake_1",
            type: "function",
            function: {
              name: "lookup_user",
              arguments: '{"id":"42"}',
            },
          },
        ]
      : null;

  const functionCall =
    scenario === "function_call"
      ? {
          name: "lookup_user",
          arguments: '{"id":"42"}',
        }
      : null;

  const baseMessage = "Hello from fake-codex.";
  const messageText = ["content_filter", "tool_call", "function_call"].includes(scenario)
    ? ""
    : baseMessage;

  if (toolCalls && parallelToolCalls) {
    write({
      type: "agent_message_delta",
      msg: {
        parallel_tool_calls: parallelToolCalls,
        delta: {
          tool_calls: [
            {
              index: 0,
              id: toolCalls[0].id,
              type: toolCalls[0].type,
              function: { name: toolCalls[0].function.name },
            },
          ],
        },
      },
    });
    await delay(5);
    const argChunks = ['{"id":"', "42", '"}'];
    for (const chunk of argChunks) {
      write({
        type: "agent_message_delta",
        msg: {
          delta: {
            tool_calls: [
              {
                index: 0,
                function: { arguments: chunk },
              },
            ],
          },
        },
      });
      await delay(5);
    }
  } else if (messageText) {
    write({ type: "agent_message_delta", msg: { delta: messageText.slice(0, 7) } });
    await delay(5);
  }

  const assistantMessage = {
    role: "assistant",
    content: toolCalls || functionCall ? null : messageText,
  };
  if (toolCalls) assistantMessage.tool_calls = toolCalls;
  if (functionCall) assistantMessage.function_call = functionCall;

  const messageEnvelope = { message: assistantMessage };
  if (!parallelToolCalls) messageEnvelope.parallel_tool_calls = false;
  write({ type: "agent_message", msg: messageEnvelope });
  await delay(5);

  const completionTokensEst = toolCalls || functionCall ? 0 : Math.ceil(messageText.length / 4);
  const tokenCountMsg = {
    prompt_tokens: 8,
    completion_tokens: completionTokensEst,
  };
  if (finishReason === "length") {
    tokenCountMsg.finish_reason = "length";
    tokenCountMsg.reason = "length";
    tokenCountMsg.token_limit_reached = true;
  } else if (finishReason === "content_filter") {
    tokenCountMsg.finish_reason = "content_filter";
  }
  write({
    type: "token_count",
    msg: tokenCountMsg,
  });
  await delay(5);
  const taskCompletePayload = {
    type: "task_complete",
    msg: { finish_reason: finishReason },
  };
  write(taskCompletePayload);
  try {
    process.stdout.end?.();
  } catch {}
};

main().catch(() => process.exit(0));
