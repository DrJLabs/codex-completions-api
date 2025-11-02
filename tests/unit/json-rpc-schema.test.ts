import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  CODEX_CLI_VERSION,
  JSONRPC_VERSION,
  extractConversationId,
  extractRequestId,
  isAgentMessageDeltaNotification,
  isAgentMessageNotification,
  isInitializeResult,
  isJsonRpcErrorResponse,
  isJsonRpcNotification,
  isJsonRpcSuccessResponse,
  isSendUserMessageResult,
  isSendUserTurnResult,
  isTokenCountNotification,
  type AgentMessageDeltaNotification,
  type AgentMessageNotification,
  type TokenCountNotification,
  type JsonRpcSuccessResponse,
  type SendUserMessageResult,
} from "../../src/lib/json-rpc/schema.ts";
import { loadTranscript } from "../shared/transcript-utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..", "..");
const FAKE_WORKER_PATH = resolve(PROJECT_ROOT, "scripts", "fake-codex-jsonrpc.js");

interface LineReader {
  read(): Promise<string>;
  close(): void;
}

function createLineReader(stream: NodeJS.ReadableStream): LineReader {
  const rl = createInterface({ input: stream });
  const queue: string[] = [];
  const waiters: Array<(line: string) => void> = [];

  rl.on("line", (line) => {
    if (waiters.length > 0) {
      // Schedule to avoid nested resolution issues.
      const next = waiters.shift();
      if (next) next(line);
    } else {
      queue.push(line);
    }
  });

  return {
    async read() {
      if (queue.length > 0) {
        return queue.shift() as string;
      }
      return new Promise<string>((resolveLine) => {
        waiters.push(resolveLine);
      });
    },
    close() {
      rl.removeAllListeners();
      rl.close();
    },
  };
}

function parseJsonLine(line: string) {
  try {
    return JSON.parse(line.trim());
  } catch {
    return null;
  }
}

async function waitForPayload<T>(
  reader: LineReader,
  predicate: (payload: any) => payload is T,
  { timeoutMs = 5000 }: { timeoutMs?: number } = {}
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error("Timed out waiting for JSON-RPC payload");
    }
    const line = await Promise.race<string | "__timeout__">([
      reader.read(),
      delay(remaining).then(() => "__timeout__" as const),
    ]);
    if (line === "__timeout__") {
      throw new Error("Timed out waiting for JSON-RPC payload");
    }
    const payload = parseJsonLine(line);
    if (!payload) continue;
    if (predicate(payload)) return payload;
  }
}

async function nextLineAsJson(reader: LineReader, timeoutMs = 5000) {
  return waitForPayload(
    reader,
    (payload: unknown): payload is Record<string, unknown> => {
      return typeof payload === "object" && payload !== null;
    },
    { timeoutMs }
  );
}

function startWorker(extraEnv: NodeJS.ProcessEnv = {}) {
  const child = spawn("node", [FAKE_WORKER_PATH], {
    env: {
      ...process.env,
      CODEX_WORKER_SUPERVISED: "true",
      ...extraEnv,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const reader = createLineReader(child.stdout);
  const stderr = child.stderr ? createLineReader(child.stderr) : null;
  return { child, reader, stderr };
}

async function waitForReady(reader: LineReader) {
  await waitForPayload(reader, (payload): payload is Record<string, unknown> => {
    return Boolean(payload && (payload as Record<string, unknown>).event === "ready");
  });
}

async function sendAndExpectResult<ResultType>(
  child: ReturnType<typeof startWorker>["child"],
  reader: LineReader,
  request: Record<string, unknown>,
  timeoutMs = 5000
): Promise<JsonRpcSuccessResponse<ResultType>> {
  child.stdin.write(`${JSON.stringify(request)}\n`);
  const response = await waitForPayload(
    reader,
    (payload): payload is Record<string, unknown> => {
      if (!payload || typeof payload !== "object") return false;
      if (!("id" in payload) || (payload as Record<string, unknown>).id !== request.id)
        return false;
      return payload.jsonrpc === JSONRPC_VERSION;
    },
    { timeoutMs }
  );

  expect(isJsonRpcSuccessResponse<ResultType>(response)).toBe(true);
  return response as JsonRpcSuccessResponse<ResultType>;
}

afterEach(async () => {
  // Give spawned processes time to exit cleanly and avoid cross-test interference.
  await delay(10);
});

describe("json-rpc schema bindings", () => {
  it("parses streaming text notifications and token counts", async () => {
    const worker = startWorker();
    try {
      await waitForReady(worker.reader);

      const initResp = await sendAndExpectResult(worker.child, worker.reader, {
        jsonrpc: JSONRPC_VERSION,
        id: 1,
        method: "initialize",
        params: { client_info: { name: "unit-test", version: "1.0.0" } },
      });
      expect(isInitializeResult(initResp.result)).toBe(true);

      const turnResp = await sendAndExpectResult(worker.child, worker.reader, {
        jsonrpc: JSONRPC_VERSION,
        id: 2,
        method: "sendUserTurn",
        params: { conversation_id: "conv-text" },
      });
      expect(isSendUserTurnResult(turnResp.result)).toBe(true);
      const conversationId =
        turnResp.result?.conversation_id ||
        (turnResp.result as Record<string, unknown>).conversationId;
      expect(typeof conversationId === "string").toBe(true);

      const requestId = "req-text";
      const sendMessageRequest = {
        jsonrpc: JSONRPC_VERSION,
        id: 3,
        method: "sendUserMessage",
        params: {
          conversation_id: conversationId,
          request_id: requestId,
          text: "User says hello",
          metadata: { include_usage: true },
        },
      } as const;

      worker.child.stdin.write(`${JSON.stringify(sendMessageRequest)}\n`);

      const notifications: Record<string, unknown>[] = [];
      let messageResponse: JsonRpcSuccessResponse<SendUserMessageResult> | null = null;
      while (!messageResponse) {
        const payload = await nextLineAsJson(worker.reader);
        if (payload.method) {
          notifications.push(payload);
          continue;
        }
        if (payload.id === sendMessageRequest.id) {
          expect(isJsonRpcSuccessResponse<SendUserMessageResult>(payload)).toBe(true);
          messageResponse = payload as JsonRpcSuccessResponse<SendUserMessageResult>;
          break;
        }
      }

      expect(messageResponse).not.toBeNull();
      expect(isSendUserMessageResult(messageResponse?.result)).toBe(true);

      const delta = notifications.find(isAgentMessageDeltaNotification);
      expect(delta).toBeDefined();
      if (delta) {
        const params = (delta as AgentMessageDeltaNotification).params;
        expect(extractConversationId(params)).toBe(conversationId);
        expect(extractRequestId(params)).toBe(requestId);
      }

      const agentMessage = notifications.find(isAgentMessageNotification);
      expect(agentMessage).toBeDefined();
      if (agentMessage) {
        const params = (agentMessage as AgentMessageNotification).params;
        expect(params.message.role).toBe("assistant");
      }

      const tokenCount = notifications.find(isTokenCountNotification);
      expect(tokenCount).toBeDefined();
      if (tokenCount) {
        const params = (tokenCount as TokenCountNotification).params;
        expect(params.prompt_tokens).toBeGreaterThanOrEqual(0);
      }

      // Ensure no unexpected error payload slipped through.
      notifications.forEach((payload) => {
        expect(isJsonRpcNotification(payload)).toBe(true);
        expect(isJsonRpcErrorResponse(payload)).toBe(false);
      });
    } finally {
      worker.reader.close();
      worker.stderr?.close();
      worker.child.kill("SIGTERM");
    }
  });

  it("validates tool-call deltas include structured payloads", async () => {
    const worker = startWorker({
      FAKE_CODEX_MODE: "tool_call",
      FAKE_CODEX_METADATA: "extra",
    });
    try {
      await waitForReady(worker.reader);

      await sendAndExpectResult(worker.child, worker.reader, {
        jsonrpc: JSONRPC_VERSION,
        id: 11,
        method: "initialize",
        params: { client_info: { name: "unit-test", version: CODEX_CLI_VERSION } },
      });

      const turnResp = await sendAndExpectResult(worker.child, worker.reader, {
        jsonrpc: JSONRPC_VERSION,
        id: 12,
        method: "sendUserTurn",
        params: {},
      });
      const conversationId =
        turnResp.result?.conversation_id ||
        (turnResp.result as Record<string, unknown>).conversationId;

      const requestId = "req-tool";
      const sendMessageRequest = {
        jsonrpc: JSONRPC_VERSION,
        id: 13,
        method: "sendUserMessage",
        params: {
          conversation_id: conversationId,
          request_id: requestId,
          text: "Execute tool",
          metadata: { include_usage: true },
        },
      } as const;

      worker.child.stdin.write(`${JSON.stringify(sendMessageRequest)}\n`);

      const notifications: Record<string, unknown>[] = [];
      let messageResponse: JsonRpcSuccessResponse<SendUserMessageResult> | null = null;
      while (!messageResponse) {
        const payload = await nextLineAsJson(worker.reader);
        if (payload.method) {
          notifications.push(payload);
          continue;
        }
        if (payload.id === sendMessageRequest.id) {
          expect(isJsonRpcSuccessResponse<SendUserMessageResult>(payload)).toBe(true);
          messageResponse = payload as JsonRpcSuccessResponse<SendUserMessageResult>;
        }
      }

      const delta = notifications.find(isAgentMessageDeltaNotification);
      expect(delta).toBeDefined();
      if (delta) {
        const params = (delta as AgentMessageDeltaNotification).params;
        expect(
          Array.isArray((params.delta as any)?.tool_calls || (params.delta as any)?.toolCalls)
        ).toBe(true);
      }

      const agentMessage = notifications.find(isAgentMessageNotification);
      expect(agentMessage).toBeDefined();
      if (agentMessage) {
        const params = (agentMessage as AgentMessageNotification).params;
        const toolCalls = params.message.tool_calls || params.message.toolCalls;
        expect(Array.isArray(toolCalls)).toBe(true);
        if (Array.isArray(toolCalls) && toolCalls[0]) {
          expect(typeof toolCalls[0].function?.name === "string").toBe(true);
          expect(typeof toolCalls[0].function?.arguments === "string").toBe(true);
        }
      }

      const tokenCount = notifications.find(isTokenCountNotification);
      expect(tokenCount).toBeDefined();

      expect(isSendUserMessageResult(messageResponse?.result)).toBe(true);
      if (messageResponse?.result?.finish_reason) {
        expect(typeof messageResponse.result.finish_reason).toBe("string");
      }
    } finally {
      worker.reader.close();
      worker.stderr?.close();
      worker.child.kill("SIGTERM");
    }
  });

  it("deserializes parity fixture streams into notification envelopes", async () => {
    const fixture = await loadTranscript("streaming-tool-calls.json", { backend: "app" });
    const conversationId = "fixture-conv";
    const requestId = "fixture-req";

    const notifications: Record<string, unknown>[] = [];
    let aggregatedContent = "";
    let aggregatedToolCalls: unknown = null;
    let finishReason: string | undefined;

    for (const entry of fixture.stream) {
      if (entry.type !== "data") continue;
      const choice = entry.data?.choices?.[0];
      if (!choice) continue;

      const delta = choice.delta ?? {};
      if (Object.keys(delta).length > 0) {
        notifications.push({
          jsonrpc: JSONRPC_VERSION,
          method: "agentMessageDelta",
          params: {
            conversation_id: conversationId,
            request_id: requestId,
            delta,
          },
        });

        if (typeof delta.content === "string") {
          aggregatedContent += delta.content;
        }
        if (Array.isArray(delta.tool_calls) && delta.tool_calls.length) {
          aggregatedToolCalls = delta.tool_calls;
        }
      }

      if (choice.finish_reason) {
        finishReason = choice.finish_reason;
      }

      if (entry.data?.usage) {
        notifications.push({
          jsonrpc: JSONRPC_VERSION,
          method: "tokenCount",
          params: {
            conversation_id: conversationId,
            request_id: requestId,
            prompt_tokens: entry.data.usage.prompt_tokens,
            completion_tokens: entry.data.usage.completion_tokens,
            total_tokens: entry.data.usage.total_tokens,
            finish_reason: choice.finish_reason ?? undefined,
          },
        });
      }
    }

    notifications.push({
      jsonrpc: JSONRPC_VERSION,
      method: "agentMessage",
      params: {
        conversation_id: conversationId,
        request_id: requestId,
        message: {
          role: "assistant",
          content: aggregatedContent || null,
          ...(aggregatedToolCalls ? { tool_calls: aggregatedToolCalls } : {}),
        },
        ...(finishReason ? { finish_reason: finishReason } : {}),
      },
    });

    expect(notifications.length).toBeGreaterThan(0);
    for (const notification of notifications) {
      expect(isJsonRpcNotification(notification)).toBe(true);
    }
  });
});
