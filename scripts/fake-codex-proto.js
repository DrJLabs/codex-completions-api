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

const CUSTOM_TOOL_ARGUMENT = String(process.env.FAKE_CODEX_TOOL_ARGUMENT || "");
const TOOL_ARGUMENT_CHUNK_SIZE = Number(process.env.FAKE_CODEX_TOOL_ARGUMENT_CHUNK_SIZE || 0);
const hasCustomToolArgument = CUSTOM_TOOL_ARGUMENT.length > 0;
const hasChunkOverride = Number.isFinite(TOOL_ARGUMENT_CHUNK_SIZE) && TOOL_ARGUMENT_CHUNK_SIZE > 0;

const buildToolArgumentPayload = (choiceIndex = 0) => {
  if (hasCustomToolArgument) return CUSTOM_TOOL_ARGUMENT;
  return `{"id":"${42 + choiceIndex}"}`;
};

const splitToolArgumentPayload = (payload, choiceIndex = 0) => {
  if (hasChunkOverride) {
    const chunks = [];
    for (let index = 0; index < payload.length; index += TOOL_ARGUMENT_CHUNK_SIZE) {
      chunks.push(payload.slice(index, index + TOOL_ARGUMENT_CHUNK_SIZE));
    }
    return chunks.length ? chunks : [payload];
  }
  if (hasCustomToolArgument) return [payload];
  return ['{"id":"', String(42 + choiceIndex), '"}'];
};

async function emitMultiChoiceToolCall(choiceCount = 2, toolCallIndexes = [0]) {
  const normalizedToolCallIndexes =
    Array.isArray(toolCallIndexes) && toolCallIndexes.length
      ? [...new Set(toolCallIndexes.filter((idx) => Number.isInteger(idx) && idx >= 0))]
      : [0];
  for (let idx = 0; idx < choiceCount; idx += 1) {
    if (normalizedToolCallIndexes.includes(idx)) {
      const toolId = `multi_tool_${idx}`;
      const argumentPayload = buildToolArgumentPayload(idx);
      write({
        type: "agent_message_delta",
        msg: {
          choice_index: idx,
          parallel_tool_calls: true,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: toolId,
                type: "function",
                function: { name: "lookup_user" },
              },
            ],
          },
        },
      });
      await delay(5);
      const argChunks = splitToolArgumentPayload(argumentPayload, idx);
      for (const chunk of argChunks) {
        write({
          type: "agent_message_delta",
          msg: {
            choice_index: idx,
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
      const xmlBlock = `<use_tool>\n  <name>lookup_user</name>\n  <id>${42 + idx}</id>\n</use_tool>`;
      write({
        type: "agent_message_delta",
        msg: {
          choice_index: idx,
          delta: {
            content: xmlBlock,
          },
        },
      });
      await delay(5);
    } else {
      write({
        type: "agent_message_delta",
        msg: {
          choice_index: idx,
          delta: {
            content: `Choice ${idx} says hello.`,
          },
        },
      });
      await delay(5);
    }
  }

  for (let idx = 0; idx < choiceCount; idx += 1) {
    if (normalizedToolCallIndexes.includes(idx)) {
      const argumentPayload = buildToolArgumentPayload(idx);
      const toolCall = {
        id: `multi_tool_${idx}`,
        type: "function",
        function: {
          name: "lookup_user",
          arguments: argumentPayload,
        },
      };
      write({
        type: "agent_message",
        msg: {
          choice_index: idx,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [toolCall],
          },
        },
      });
    } else {
      write({
        type: "agent_message",
        msg: {
          choice_index: idx,
          message: {
            role: "assistant",
            content: `Choice ${idx} says hello.`,
          },
        },
      });
    }
    await delay(5);
  }
}

async function emitMultiToolBurst(count = 2) {
  const normalizedCount = Number.isInteger(count) && count > 0 ? count : 1;
  const toolCalls = [];
  for (let idx = 0; idx < normalizedCount; idx += 1) {
    const toolId = `burst_tool_${idx}`;
    const fnName = idx % 2 === 0 ? "lookup_user" : "send_email";
    const argumentPayload = buildToolArgumentPayload(idx);
    toolCalls.push({
      id: toolId,
      type: "function",
      function: {
        name: fnName,
        arguments: argumentPayload,
      },
    });
    write({
      type: "agent_message_delta",
      msg: {
        parallel_tool_calls: true,
        delta: {
          tool_calls: [
            {
              index: idx,
              id: toolId,
              type: "function",
              function: { name: fnName },
            },
          ],
        },
      },
    });
    await delay(5);
    const argChunks = splitToolArgumentPayload(argumentPayload, idx);
    for (const chunk of argChunks) {
      write({
        type: "agent_message_delta",
        msg: {
          choice_index: 0,
          delta: {
            tool_calls: [
              {
                index: idx,
                function: { arguments: chunk },
              },
            ],
          },
        },
      });
      await delay(5);
    }
    const xmlBlock = `<use_tool>\n  <name>${fnName}</name>\n  <args>${argumentPayload}</args>\n</use_tool>`;
    write({
      type: "agent_message_delta",
      msg: {
        choice_index: 0,
        delta: {
          content: xmlBlock,
        },
      },
    });
    await delay(5);
  }

  write({
    type: "agent_message",
    msg: {
      choice_index: 0,
      message: {
        role: "assistant",
        content: null,
        tool_calls: toolCalls,
      },
    },
  });
  await delay(5);
  return toolCalls.length;
}

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

  let requestBody = {};
  try {
    requestBody = JSON.parse(submission || "{}");
  } catch {}
  const choiceCountEnv = Number(process.env.FAKE_CODEX_CHOICE_COUNT);
  const choiceCount =
    (Number.isFinite(choiceCountEnv) && choiceCountEnv > 0 ? choiceCountEnv : null) ||
    Number(requestBody?.n) ||
    Number(requestBody?.op?.args?.n) ||
    1;

  // Emit a deterministic short response
  write({ type: "session_configured" });
  write({ type: "task_started" });
  await delay(10);

  const scenario = String(process.env.FAKE_CODEX_MODE || "").toLowerCase();
  write({ type: "agent_reasoning_delta", msg: { delta: "…" } });
  await delay(10);
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
  const singleToolArgument = buildToolArgumentPayload();
  const toolCalls =
    scenario === "tool_call"
      ? [
          {
            id: "tool_fake_1",
            type: "function",
            function: {
              name: "lookup_user",
              arguments: singleToolArgument,
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

  if (scenario === "multi_choice_tool_call") {
    const toolCallChoicesRaw = String(process.env.FAKE_CODEX_TOOL_CALL_CHOICES || "").trim();
    const toolCallIndexes = toolCallChoicesRaw
      ? toolCallChoicesRaw
          .split(",")
          .map((value) => Number(value.trim()))
          .filter((value) => Number.isInteger(value) && value >= 0)
      : [0];
    await emitMultiChoiceToolCall(choiceCount, toolCallIndexes.length ? toolCallIndexes : [0]);
    const tokenCountMsg = {
      prompt_tokens: 8,
      completion_tokens: 0,
    };
    write({
      type: "token_count",
      msg: tokenCountMsg,
    });
    await delay(5);
    write({
      type: "task_complete",
      msg: { finish_reason: finishReason },
    });
    try {
      process.stdout.end?.();
    } catch {}
    return;
  }

  if (scenario === "multi_tool_burst") {
    const burstCountEnv = Number(process.env.FAKE_CODEX_TOOL_BURST_COUNT);
    const burstCount = Number.isInteger(burstCountEnv) && burstCountEnv > 0 ? burstCountEnv : 2;
    await emitMultiToolBurst(burstCount);
    const tokenCountMsg = {
      prompt_tokens: 8,
      completion_tokens: 0,
    };
    write({
      type: "token_count",
      msg: tokenCountMsg,
    });
    await delay(5);
    write({
      type: "task_complete",
      msg: { finish_reason: finishReason },
    });
    try {
      process.stdout.end?.();
    } catch {}
    return;
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
    const argChunks = splitToolArgumentPayload(singleToolArgument);
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
