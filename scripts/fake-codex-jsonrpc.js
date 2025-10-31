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

  for await (const chunk of process.stdin) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch (err) {
      write({ event: "decode_error", message: err.message });
      continue;
    }

    const { method, id, params = {} } = message;

    if (!method && id !== undefined) {
      // Ignore stray responses
      continue;
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
        const text = String(params.text || "");
        if (hangMode === "message") {
          // Simulate a stalled worker by not emitting any response.
          continue;
        }
        write({
          jsonrpc: "2.0",
          method: "agentMessageDelta",
          params: {
            conversation_id: convId,
            request_id: params.request_id || convId,
            delta: text ? `echo:${text}` : "hello",
          },
        });
        write({
          jsonrpc: "2.0",
          method: "agentMessage",
          params: {
            conversation_id: convId,
            request_id: params.request_id || convId,
            message: {
              role: "assistant",
              content: text ? `Echo: ${text}` : "Hello from fake jsonrpc",
            },
          },
        });
        write({
          jsonrpc: "2.0",
          method: "tokenCount",
          params: {
            conversation_id: convId,
            request_id: params.request_id || convId,
            prompt_tokens: 8,
            completion_tokens: 6,
            finish_reason: "stop",
          },
        });
        write({
          jsonrpc: "2.0",
          id,
          result: {
            finish_reason: "stop",
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
