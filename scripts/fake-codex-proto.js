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

const runProto = async () => {
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
  const metadataMode = String(process.env.FAKE_CODEX_METADATA || "").toLowerCase();
  const metadataPayload =
    metadataMode && metadataMode !== "false"
      ? {
          rollout_path: "/app/.codex-api/sessions/fake-rollout",
          session_id: "fake-session-123",
          ...(metadataMode === "extra" ? { build_id: "fake-build" } : {}),
        }
      : null;
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
  const includeMessageText = !["content_filter", "tool_call", "function_call"].includes(scenario);
  let messageText = includeMessageText ? baseMessage : "";
  if (includeMessageText && metadataPayload) {
    const lines = Object.entries(metadataPayload)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n");
    messageText = `${baseMessage}\n${lines}`;
  }

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
    write({ type: "agent_message_delta", msg: { delta: messageText } });
    await delay(5);
  }

  const assistantMessage = {
    role: "assistant",
    content: toolCalls || functionCall ? null : messageText,
  };
  if (toolCalls) assistantMessage.tool_calls = toolCalls;
  if (functionCall) assistantMessage.function_call = functionCall;
  if (metadataPayload) assistantMessage.metadata = metadataPayload;

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

const runAppServerSupervised = async () => {
  const readyDelay = Number(process.env.FAKE_CODEX_WORKER_READY_DELAY_MS ?? 50);
  const heartbeatMs = Number(process.env.FAKE_CODEX_WORKER_HEARTBEAT_MS ?? 500);
  const autoExitMs = Number(process.env.FAKE_CODEX_WORKER_AUTOEXIT_MS ?? 0);
  const shutdownDelayMs = Number(process.env.FAKE_CODEX_WORKER_SHUTDOWN_DELAY_MS ?? 50);
  const exitCode = Number(process.env.FAKE_CODEX_WORKER_EXIT_CODE ?? 0);

  const log = (payload) => {
    try {
      process.stdout.write(JSON.stringify({ ts: Date.now(), ...payload }) + "\n");
    } catch {}
  };

  log({ event: "starting" });
  await delay(readyDelay);
  log({ event: "ready" });

  const heartbeat = setInterval(() => log({ event: "heartbeat" }), heartbeatMs);
  let autoExitTimer = null;
  if (autoExitMs > 0) {
    autoExitTimer = setTimeout(() => {
      clearInterval(heartbeat);
      log({ event: "exit", reason: "auto" });
      process.exit(exitCode);
    }, autoExitMs);
  }

  const teardown = (signal) => {
    log({ event: "shutdown", phase: "signal", signal });
    clearInterval(heartbeat);
    if (autoExitTimer) {
      clearTimeout(autoExitTimer);
      autoExitTimer = null;
    }
    setTimeout(() => {
      log({ event: "shutdown", phase: "complete" });
      process.exit(0);
    }, shutdownDelayMs);
  };

  process.on("SIGTERM", () => teardown("SIGTERM"));
  process.on("SIGINT", () => teardown("SIGINT"));

  // Keep process alive
  await new Promise(() => {});
};

const modeArg = process.argv[2];
const supervised =
  String(process.env.CODEX_WORKER_SUPERVISED || "")
    .trim()
    .toLowerCase() === "true";
if (modeArg === "app-server" && supervised) {
  runAppServerSupervised().catch(() => process.exit(0));
} else {
  runProto().catch(() => process.exit(0));
}
