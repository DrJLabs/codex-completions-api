#!/usr/bin/env node

import { setTimeout as delay } from "node:timers/promises";

const supervised =
  String(process.env.CODEX_WORKER_SUPERVISED || "")
    .trim()
    .toLowerCase() === "true";

const readyDelayMs = Number(process.env.FAKE_CODEX_WORKER_READY_DELAY_MS ?? 20);
const heartbeatMs = Number(process.env.FAKE_CODEX_WORKER_HEARTBEAT_MS ?? 0);
const autoExitMs = Number(process.env.FAKE_CODEX_WORKER_AUTOEXIT_MS ?? 0);
const shutdownDelayMs = Number(process.env.FAKE_CODEX_WORKER_SHUTDOWN_DELAY_MS ?? 20);
const exitCode = Number(process.env.FAKE_CODEX_WORKER_EXIT_CODE ?? 0);

let heartbeatTimer = null;
let autoExitTimer = null;

const clearTimers = () => {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (autoExitTimer) {
    clearTimeout(autoExitTimer);
    autoExitTimer = null;
  }
};

const write = (payload) => {
  try {
    process.stdout.write(JSON.stringify(payload) + "\n");
  } catch {}
};

const hangMode = String(process.env.FAKE_CODEX_JSONRPC_HANG || "").toLowerCase();
const handshakeMode = String(process.env.FAKE_CODEX_HANDSHAKE_MODE || "").toLowerCase();
const skipReadyEvent = /^(1|true|yes)$/i.test(String(process.env.FAKE_CODEX_SKIP_READY || ""));
const captureRpc = /^(1|true|yes)$/i.test(String(process.env.FAKE_CODEX_CAPTURE_RPCS || ""));
const emitCapture = (direction, payload) => {
  if (!captureRpc) return;
  try {
    process.stderr.write(`${JSON.stringify({ capture: { direction, payload } })}\n`);
  } catch {}
};

async function runJsonRpcWorker() {
  process.stdin.setEncoding("utf8");
  write({ event: "starting" });
  await delay(Math.max(0, readyDelayMs));
  if (!skipReadyEvent) {
    write({ event: "ready", ready: true });
  }

  if (heartbeatMs > 0) {
    heartbeatTimer = setInterval(() => {
      write({ event: "heartbeat" });
    }, heartbeatMs);
  }

  if (autoExitMs > 0) {
    autoExitTimer = setTimeout(() => {
      clearTimers();
      write({ event: "exit", reason: "auto" });
      process.exit(exitCode);
    }, autoExitMs);
  }

  let conversationSeq = 0;
  let subscriptionSeq = 0;
  const conversations = new Map();
  const subscriptions = new Map();
  const resolveConversationId = (params = {}) => {
    const provided = params.conversation_id || params.conversationId;
    if (provided) {
      if (!conversations.has(provided)) conversations.set(provided, {});
      return provided;
    }
    const generated = `conv-${++conversationSeq}`;
    conversations.set(generated, {});
    return generated;
  };

  const handleLine = (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch (err) {
      write({ event: "decode_error", message: err.message });
      return;
    }

    const { method, id, params = {} } = message;

    if (!method && id !== undefined) {
      // Ignore stray responses
      return;
    }

    switch (method) {
      case "initialize": {
        emitCapture("request", message);
        if (handshakeMode === "timeout") {
          return;
        }
        if (handshakeMode === "error") {
          write({
            jsonrpc: "2.0",
            id,
            error: {
              code: "handshake_failed",
              message: "handshake failed",
              data: { retryable: true },
            },
          });
          break;
        }
        if (handshakeMode === "exit") {
          process.nextTick(() => {
            clearTimers();
            process.exit(1);
          });
          return;
        }
        write({
          jsonrpc: "2.0",
          id,
          result: { advertised_models: ["codex-5"] },
        });
        break;
      }
      case "newConversation": {
        emitCapture("request", message);
        const convId = `conv-${++conversationSeq}`;
        conversations.set(convId, { lastTurn: null });
        write({
          jsonrpc: "2.0",
          id,
          result: {
            conversation_id: convId,
            conversationId: convId,
            model: params?.model || process.env.CODEX_MODEL || "codex-5",
            reasoning_effort: null,
            reasoningEffort: null,
            rollout_path: `/tmp/${convId}.jsonl`,
            rolloutPath: `/tmp/${convId}.jsonl`,
          },
        });
        break;
      }
      case "addConversationListener": {
        emitCapture("request", message);
        const convId = resolveConversationId(params);
        const subscriptionId = `sub-${++subscriptionSeq}`;
        subscriptions.set(subscriptionId, convId);
        write({
          jsonrpc: "2.0",
          id,
          result: {
            subscription_id: subscriptionId,
            subscriptionId,
          },
        });
        break;
      }
      case "removeConversationListener": {
        emitCapture("request", message);
        const subscriptionId = params?.subscription_id || params?.subscriptionId;
        if (subscriptionId) subscriptions.delete(subscriptionId);
        write({ jsonrpc: "2.0", id, result: {} });
        break;
      }
      case "sendUserTurn": {
        emitCapture("request", message);
        const convId = resolveConversationId(params);
        const existing = conversations.get(convId) || {};
        conversations.set(convId, { ...existing, lastTurn: params });
        write({ jsonrpc: "2.0", id, result: { conversation_id: convId } });
        break;
      }
      case "sendUserMessage": {
        emitCapture("request", message);
        const convId = resolveConversationId(params);
        if (hangMode === "message") {
          // Simulate a stalled worker by not emitting any response.
          return;
        }
        const scenario = String(process.env.FAKE_CODEX_MODE || "").toLowerCase();
        if (scenario === "crash") {
          process.nextTick(() => {
            clearTimers();
            process.exit(1);
          });
          return;
        }
        if (scenario === "error") {
          write({
            jsonrpc: "2.0",
            id,
            error: {
              code: "worker_error",
              message: "synthetic worker error",
              data: { retryable: false },
            },
          });
          return;
        }
        const requestedFinish = String(process.env.FAKE_CODEX_FINISH_REASON || "stop")
          .trim()
          .toLowerCase();
        let finishReason = "stop";
        if (
          ["length", "max_tokens", "token_limit", "token_limit_reached"].includes(requestedFinish)
        ) {
          finishReason = "length";
        }
        if (scenario === "truncation") {
          finishReason = "length";
        }
        if (scenario === "content_filter") {
          finishReason = "content_filter";
        } else if (scenario === "function_call" && finishReason !== "length") {
          finishReason = "function_call";
        } else if (scenario === "tool_call" && finishReason !== "length") {
          finishReason = "tool_calls";
        }

        const parallelToolCalls = !/^false$/i.test(
          String(process.env.FAKE_CODEX_PARALLEL || "true")
        );
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
        const includeMessageText = !["content_filter", "tool_call", "function_call"].includes(
          scenario
        );
        let messageText = includeMessageText ? baseMessage : "";
        if (includeMessageText && metadataPayload) {
          const lines = Object.entries(metadataPayload)
            .map(([key, value]) => `${key}: ${value}`)
            .join("\n");
          messageText = `${baseMessage}\n${lines}`;
        }

        if (scenario === "truncation" && !toolCalls && !functionCall) {
          messageText = "Hello (truncated) from fake-codex.";
        }

        if (toolCalls && parallelToolCalls) {
          write({
            jsonrpc: "2.0",
            method: "agentMessageDelta",
            params: {
              conversation_id: convId,
              request_id: params.request_id || convId,
              parallel_tool_calls: true,
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
          const argChunks = ['{"id":"', "42", '"}'];
          for (const chunk of argChunks) {
            write({
              jsonrpc: "2.0",
              method: "agentMessageDelta",
              params: {
                conversation_id: convId,
                request_id: params.request_id || convId,
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
          }
        } else if (messageText) {
          write({
            jsonrpc: "2.0",
            method: "agentMessageDelta",
            params: {
              conversation_id: convId,
              request_id: params.request_id || convId,
              delta: messageText,
            },
          });
        }

        const assistantMessage = {
          role: "assistant",
          content: toolCalls || functionCall ? null : messageText,
        };
        if (toolCalls) assistantMessage.tool_calls = toolCalls;
        if (functionCall) assistantMessage.function_call = functionCall;
        if (metadataPayload) assistantMessage.metadata = metadataPayload;

        const messageEnvelope = {
          conversation_id: convId,
          request_id: params.request_id || convId,
          message: assistantMessage,
        };
        if (toolCalls) {
          messageEnvelope.parallel_tool_calls = parallelToolCalls;
        }
        write({
          jsonrpc: "2.0",
          method: "agentMessage",
          params: messageEnvelope,
        });

        let promptTokens = 8;
        let completionTokens = toolCalls || functionCall ? 0 : Math.ceil(messageText.length / 4);
        if (scenario === "truncation" && !toolCalls && !functionCall) {
          promptTokens = 5;
          completionTokens = 9;
        }
        const usagePayload = {
          conversation_id: convId,
          request_id: params.request_id || convId,
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
        };
        if (finishReason === "length") {
          usagePayload.finish_reason = "length";
          usagePayload.reason = "length";
          usagePayload.token_limit_reached = true;
        } else if (finishReason === "content_filter") {
          usagePayload.finish_reason = "content_filter";
        }
        write({
          jsonrpc: "2.0",
          method: "tokenCount",
          params: usagePayload,
        });

        write({
          jsonrpc: "2.0",
          id,
          result: {
            finish_reason: finishReason,
          },
        });
        break;
      }
      default: {
        write({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: `Unknown method: ${method}`,
          },
        });
        break;
      }
    }
  };

  let buffer = "";
  for await (const chunk of process.stdin) {
    buffer += chunk;
    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) break;
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, "").trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;
      handleLine(line);
    }
  }

  const trailing = buffer.replace(/\r$/, "").trim();
  if (trailing) {
    handleLine(trailing);
  }
}

function setupSignalHandlers() {
  const shutdown = (signal) => {
    write({ event: "shutdown", signal });
    clearTimers();
    setTimeout(() => process.exit(0), Math.max(0, shutdownDelayMs));
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

async function main() {
  setupSignalHandlers();
  await runJsonRpcWorker();
  await new Promise(() => {}); // keep alive
}

if (supervised) {
  main().catch((err) => {
    write({ event: "fatal", message: err?.message || String(err) });
    clearTimers();
    process.exit(1);
  });
} else {
  // Fallback: behave similar to proto shim for direct execution
  write({ event: "fallback", mode: "proto" });
  process.stdin.resume();
}
