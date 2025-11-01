#!/usr/bin/env node

import { setTimeout as delay } from "node:timers/promises";

const supervised =
  String(process.env.CODEX_WORKER_SUPERVISED || "")
    .trim()
    .toLowerCase() === "true";

const write = (payload) => {
  try {
    process.stdout.write(JSON.stringify(payload) + "\n");
  } catch {}
};

const hangMode = String(process.env.FAKE_CODEX_JSONRPC_HANG || "").toLowerCase();

async function runJsonRpcWorker() {
  process.stdin.setEncoding("utf8");
  write({ event: "starting" });
  await delay(20);
  write({ event: "ready", ready: true });

  let conversationSeq = 0;
  const resolveConversationId = (params = {}) =>
    params.conversation_id || params.conversationId || `conv-${++conversationSeq}`;

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
        write({
          jsonrpc: "2.0",
          id,
          result: { advertised_models: ["codex-5"] },
        });
        break;
      }
      case "sendUserTurn": {
        const convId = resolveConversationId(params);
        write({ jsonrpc: "2.0", id, result: { conversation_id: convId } });
        break;
      }
      case "sendUserMessage": {
        const convId = resolveConversationId(params);
        if (hangMode === "message") {
          // Simulate a stalled worker by not emitting any response.
          return;
        }
        const scenario = String(process.env.FAKE_CODEX_MODE || "").toLowerCase();
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
    setTimeout(() => process.exit(0), 20);
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
    process.exit(1);
  });
} else {
  // Fallback: behave similar to proto shim for direct execution
  write({ event: "fallback", mode: "proto" });
  process.stdin.resume();
}
