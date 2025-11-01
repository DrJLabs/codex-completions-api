import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import { config as CFG } from "../../config/index.js";
import { nanoid } from "nanoid";
import {
  ensureWorkerSupervisor,
  getWorkerChildProcess,
  getWorkerSupervisor,
  onWorkerSupervisorEvent,
} from "../worker/supervisor.js";
import { isAppServerMode } from "../backend-mode.js";

const JSONRPC_VERSION = "2.0";
const LOG_PREFIX = "[proxy][json-rpc-transport]";
const DEFAULT_CLIENT_INFO = {
  name: "codex-completions-api",
  version: "1.0.0",
};

class TransportError extends Error {
  constructor(message, { code = "transport_error", retryable = false } = {}) {
    super(message);
    this.name = "JsonRpcTransportError";
    this.code = code;
    this.retryable = retryable;
  }
}

class RequestContext {
  #resolve;
  #reject;
  constructor({ requestId, timeoutMs, onTimeout }) {
    this.requestId = requestId;
    this.clientConversationId = `ctx_${nanoid(12)}`;
    this.conversationId = null;
    this.emitter = new EventEmitter();
    this.usage = { prompt_tokens: 0, completion_tokens: 0 };
    this.rpc = { turnId: null, messageId: null };
    this.result = null;
    this.finalMessage = null;
    this.finishReason = null;
    this.deltas = [];
    this.completed = false;
    this.timeout = setTimeout(() => {
      if (this.completed) return;
      onTimeout?.(this);
    }, timeoutMs);
    this.promise = new Promise((resolve, reject) => {
      this.#resolve = (value) => {
        if (this.completed) return;
        this.completed = true;
        clearTimeout(this.timeout);
        resolve(value);
      };
      this.#reject = (err) => {
        if (this.completed) return;
        this.completed = true;
        clearTimeout(this.timeout);
        reject(err);
      };
    });
  }

  addDelta(payload) {
    this.deltas.push(payload);
    this.emitter.emit("delta", payload);
  }

  setFinalMessage(payload) {
    this.finalMessage = payload;
    this.emitter.emit("message", payload);
  }

  setUsage(payload) {
    if (payload && typeof payload === "object") {
      if (Number.isFinite(payload.prompt_tokens)) {
        this.usage.prompt_tokens = Number(payload.prompt_tokens);
      }
      if (Number.isFinite(payload.completion_tokens)) {
        this.usage.completion_tokens = Number(payload.completion_tokens);
      }
      if (payload.finish_reason && typeof payload.finish_reason === "string") {
        this.finishReason = payload.finish_reason;
      }
    }
    this.emitter.emit("usage", payload);
  }

  setResult(payload) {
    this.result = payload;
    this.emitter.emit("result", payload);
  }

  setFinishReason(reason) {
    if (reason) this.finishReason = reason;
  }

  resolve(value) {
    this.#resolve?.(value);
    this.emitter.emit("end", value);
  }

  reject(err) {
    this.#reject?.(err);
    this.emitter.emit("error", err);
  }

  abort(err) {
    this.reject(err);
  }
}

class JsonRpcTransport {
  constructor() {
    this.supervisor = getWorkerSupervisor();
    this.child = null;
    this.stdoutReader = null;
    this.stderrReader = null;
    this.handshakeCompleted = false;
    this.handshakeData = null;
    this.handshakePromise = null;
    this.rpcSeq = 1;
    this.pending = new Map();
    this.contextsByConversation = new Map();
    this.contextsByRequest = new Map();
    this.activeRequests = 0;
    this.destroyed = false;

    this.unsubscribeSpawn = onWorkerSupervisorEvent("spawn", (child) => {
      this.#onSpawn(child);
    });
    this.unsubscribeExit = onWorkerSupervisorEvent("exit", (info) => {
      this.#onExit(info);
    });

    const currentChild = getWorkerChildProcess();
    if (currentChild) {
      this.#attachChild(currentChild);
    }
  }

  destroy() {
    this.destroyed = true;
    this.unsubscribeSpawn?.();
    this.unsubscribeExit?.();
    this.#detachChild();
    for (const pending of this.pending.values()) {
      try {
        pending.reject?.(new TransportError("transport destroyed", { retryable: true }));
      } catch {}
    }
    this.pending.clear();
    for (const context of this.contextsByRequest.values()) {
      context.reject(new TransportError("transport destroyed", { retryable: true }));
    }
    this.contextsByConversation.clear();
    this.contextsByRequest.clear();
  }

  async ensureHandshake() {
    if (this.handshakeCompleted && this.handshakeData) return this.handshakeData;
    if (this.handshakePromise) return this.handshakePromise;
    await this.supervisor.waitForReady(CFG.WORKER_STARTUP_TIMEOUT_MS);
    this.handshakePromise = new Promise((resolve, reject) => {
      const rpcId = this.#nextRpcId();
      const timeout = setTimeout(() => {
        this.pending.delete(rpcId);
        this.handshakePromise = null;
        reject(
          new TransportError("JSON-RPC handshake timed out", {
            code: "handshake_timeout",
            retryable: true,
          })
        );
      }, CFG.WORKER_HANDSHAKE_TIMEOUT_MS);
      this.pending.set(rpcId, {
        type: "initialize",
        timeout,
        resolve: (result) => {
          clearTimeout(timeout);
          this.handshakeCompleted = true;
          this.handshakeData = {
            raw: result,
            models: this.#extractAdvertisedModels(result),
          };
          this.pending.delete(rpcId);
          this.handshakePromise = null;
          resolve(this.handshakeData);
        },
        reject: (err) => {
          clearTimeout(timeout);
          this.pending.delete(rpcId);
          this.handshakePromise = null;
          reject(err instanceof Error ? err : new TransportError(String(err)));
        },
      });

      try {
        this.#write({
          jsonrpc: JSONRPC_VERSION,
          id: rpcId,
          method: "initialize",
          params: { client_info: DEFAULT_CLIENT_INFO },
        });
      } catch (err) {
        clearTimeout(timeout);
        this.pending.delete(rpcId);
        this.handshakePromise = null;
        reject(err);
      }
    });
    return this.handshakePromise;
  }

  async createChatRequest({ requestId, timeoutMs, signal }) {
    if (this.destroyed) throw new TransportError("transport destroyed", { retryable: true });
    if (!this.child)
      throw new TransportError("worker not available", {
        code: "worker_unavailable",
        retryable: true,
      });
    if (this.activeRequests >= Math.max(1, CFG.WORKER_MAX_CONCURRENCY)) {
      throw new TransportError("worker at capacity", { code: "worker_busy", retryable: true });
    }

    await this.ensureHandshake();

    const context = new RequestContext({
      requestId,
      timeoutMs: timeoutMs ?? CFG.WORKER_REQUEST_TIMEOUT_MS,
      onTimeout: (ctx) =>
        this.#failContext(
          ctx,
          new TransportError("request timeout", {
            code: "worker_request_timeout",
            retryable: true,
          })
        ),
    });

    this.contextsByRequest.set(requestId, context);
    this.contextsByConversation.set(context.clientConversationId, context);
    this.activeRequests += 1;

    if (signal) {
      if (signal.aborted) {
        this.#failContext(
          context,
          new TransportError("request aborted", { code: "request_aborted", retryable: false })
        );
        throw new TransportError("request aborted", { code: "request_aborted", retryable: false });
      }
      const abortHandler = () => {
        signal.removeEventListener("abort", abortHandler);
        this.#failContext(
          context,
          new TransportError("request aborted", {
            code: "request_aborted",
            retryable: false,
          })
        );
      };
      signal.addEventListener("abort", abortHandler, { once: true });
      context.emitter.once("end", () => signal.removeEventListener("abort", abortHandler));
      context.emitter.once("error", () => signal.removeEventListener("abort", abortHandler));
    }

    this.#sendUserTurn(context);
    return context;
  }

  sendUserMessage(context, payload) {
    if (!context) throw new TransportError("invalid context");
    if (!this.child) {
      this.#failContext(
        context,
        new TransportError("worker unavailable", { code: "worker_unavailable", retryable: true })
      );
      return;
    }
    const messageRpcId = this.#nextRpcId();
    context.rpc.messageId = messageRpcId;
    const timeout = setTimeout(() => {
      this.pending.delete(messageRpcId);
      this.#failContext(
        context,
        new TransportError("sendUserMessage timeout", {
          code: "worker_request_timeout",
          retryable: true,
        })
      );
    }, CFG.WORKER_REQUEST_TIMEOUT_MS);
    this.pending.set(messageRpcId, {
      type: "sendUserMessage",
      context,
      timeout,
      resolve: (result) => {
        clearTimeout(timeout);
        this.pending.delete(messageRpcId);
        context.setResult(result);
        const finishReason = result?.finish_reason || result?.status;
        context.setFinishReason(finishReason);
        this.#completeContext(context);
      },
      reject: (err) => {
        clearTimeout(timeout);
        this.pending.delete(messageRpcId);
        this.#failContext(
          context,
          err instanceof Error ? err : new TransportError(String(err), { retryable: true })
        );
      },
    });

    const params = {
      conversation_id: context.conversationId ?? context.clientConversationId,
      request_id: context.clientConversationId,
      text: payload?.text ?? "",
      metadata: payload?.metadata ?? null,
    };

    try {
      this.#write({
        jsonrpc: JSONRPC_VERSION,
        id: messageRpcId,
        method: "sendUserMessage",
        params,
      });
    } catch (err) {
      clearTimeout(timeout);
      this.pending.delete(messageRpcId);
      this.#failContext(
        context,
        err instanceof Error ? err : new TransportError(String(err), { retryable: true })
      );
    }
  }

  cancelContext(context, error = null) {
    if (!context) return;
    const reason =
      error instanceof TransportError
        ? error
        : new TransportError(String(error?.message || "request aborted"), {
            code: "request_aborted",
            retryable: false,
          });
    let handledByPending = false;
    for (const [rpcId, pending] of this.pending.entries()) {
      if (pending.context !== context) continue;
      handledByPending = true;
      clearTimeout(pending.timeout);
      this.pending.delete(rpcId);
      try {
        pending.reject?.(reason);
      } catch (err) {
        console.warn(`${LOG_PREFIX} pending reject failed`, err);
      }
    }
    if (!context.completed) {
      this.#failContext(context, reason);
    }
  }

  #sendUserTurn(context) {
    if (!this.child) {
      this.#failContext(
        context,
        new TransportError("worker unavailable", { code: "worker_unavailable", retryable: true })
      );
      return;
    }
    const turnRpcId = this.#nextRpcId();
    context.rpc.turnId = turnRpcId;
    const timeout = setTimeout(() => {
      this.pending.delete(turnRpcId);
      this.#failContext(
        context,
        new TransportError("sendUserTurn timeout", {
          code: "worker_request_timeout",
          retryable: true,
        })
      );
    }, CFG.WORKER_REQUEST_TIMEOUT_MS);
    this.pending.set(turnRpcId, {
      type: "sendUserTurn",
      context,
      timeout,
      resolve: (result) => {
        clearTimeout(timeout);
        this.pending.delete(turnRpcId);
        const serverConversationId =
          result?.conversation_id || result?.conversationId || context.clientConversationId;
        context.conversationId = serverConversationId;
        if (serverConversationId && serverConversationId !== context.clientConversationId) {
          this.contextsByConversation.set(serverConversationId, context);
        }
        context.emitter.emit("turn", result);
      },
      reject: (err) => {
        clearTimeout(timeout);
        this.pending.delete(turnRpcId);
        this.#failContext(
          context,
          err instanceof Error ? err : new TransportError(String(err), { retryable: true })
        );
      },
    });

    try {
      this.#write({
        jsonrpc: JSONRPC_VERSION,
        id: turnRpcId,
        method: "sendUserTurn",
        params: {
          conversation_id: context.clientConversationId,
          request_id: context.clientConversationId,
        },
      });
    } catch (err) {
      clearTimeout(timeout);
      this.pending.delete(turnRpcId);
      this.#failContext(
        context,
        err instanceof Error ? err : new TransportError(String(err), { retryable: true })
      );
    }
  }

  #attachChild(child) {
    this.#detachChild();
    this.child = child;
    if (!child?.stdout) return;
    this.stdoutReader = createInterface({ input: child.stdout });
    this.stdoutReader.on("line", (line) => this.#handleLine(line));
    this.stdoutReader.on("close", () => {
      this.stdoutReader = null;
    });
    child.stdout.on("error", (err) => {
      console.warn(`${LOG_PREFIX} stdout error`, err);
    });
    if (child.stderr) {
      this.stderrReader = createInterface({ input: child.stderr });
      this.stderrReader.on("line", (line) => {
        if (!line.trim()) return;
        console.warn(`${LOG_PREFIX} worker stderr: ${line}`);
      });
      this.stderrReader.on("close", () => {
        this.stderrReader = null;
      });
    }
    this.handshakeCompleted = false;
    this.handshakeData = null;
    this.handshakePromise = null;
  }

  #detachChild() {
    if (this.stdoutReader) {
      try {
        this.stdoutReader.removeAllListeners();
        this.stdoutReader.close();
      } catch {}
      this.stdoutReader = null;
    }
    if (this.stderrReader) {
      try {
        this.stderrReader.removeAllListeners();
        this.stderrReader.close();
      } catch {}
      this.stderrReader = null;
    }
    this.child = null;
  }

  #onSpawn(child) {
    this.#attachChild(child);
  }

  #onExit(info) {
    this.#detachChild();
    this.handshakeCompleted = false;
    this.handshakeData = null;
    this.handshakePromise = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject?.(
        new TransportError("worker exited", { code: "worker_exited", retryable: true })
      );
    }
    this.pending.clear();
    for (const context of this.contextsByRequest.values()) {
      this.#failContext(
        context,
        new TransportError("worker exited", { code: "worker_exited", retryable: true })
      );
    }
    this.contextsByConversation.clear();
    this.contextsByRequest.clear();
    this.activeRequests = 0;
    if (info && info.code !== 0) {
      console.warn(`${LOG_PREFIX} worker exit code=${info.code} signal=${info.signal}`);
    }
  }

  #handleLine(line) {
    const trimmed = line?.trim();
    if (!trimmed) return;
    let payload;
    try {
      payload = JSON.parse(trimmed);
    } catch (err) {
      console.warn(`${LOG_PREFIX} unable to parse worker output`, err, trimmed);
      return;
    }
    if (payload.id !== undefined) {
      this.#handleRpcResponse(payload);
      return;
    }
    if (payload.method) {
      this.#handleNotification(payload);
      return;
    }
    console.warn(`${LOG_PREFIX} unrecognized worker message`, payload);
  }

  #handleRpcResponse(message) {
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(message.id);
    if (message.error) {
      const errMessage = message.error?.message || "JSON-RPC error";
      const error = new TransportError(errMessage, {
        code: message.error?.code || "worker_error",
        retryable: true,
      });
      pending.reject?.(error);
      return;
    }
    pending.resolve?.(message.result ?? null);
  }

  #handleNotification(message) {
    const params = message.params || {};
    const context = this.#resolveContext(params);
    if (!context) return;
    switch (String(message.method)) {
      case "agentMessageDelta":
        context.addDelta(params);
        break;
      case "agentMessage":
        context.setFinalMessage(params);
        break;
      case "tokenCount":
        context.setUsage(params);
        break;
      case "requestTimeout":
        this.#failContext(
          context,
          new TransportError("worker reported timeout", {
            code: "worker_request_timeout",
            retryable: true,
          })
        );
        break;
      default:
        context.emitter.emit("notification", message);
        break;
    }
  }

  #resolveContext(params) {
    const idCandidates = [
      params?.conversation_id,
      params?.conversationId,
      params?.conversation?.id,
      params?.context?.conversation_id,
      params?.request_id,
      params?.requestId,
    ];
    for (const candidate of idCandidates) {
      if (!candidate) continue;
      const ctx =
        this.contextsByConversation.get(candidate) || this.contextsByRequest.get(candidate);
      if (ctx) return ctx;
    }
    // Fallback: single active request
    if (this.contextsByRequest.size === 1) {
      return this.contextsByRequest.values().next().value;
    }
    return null;
  }

  #completeContext(context) {
    if (context.completed) return;
    this.contextsByConversation.delete(context.clientConversationId);
    if (context.conversationId) {
      this.contextsByConversation.delete(context.conversationId);
    }
    this.contextsByRequest.delete(context.requestId);
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    const payload = {
      requestId: context.requestId,
      conversationId: context.conversationId ?? context.clientConversationId,
      result: context.result,
      finalMessage: context.finalMessage,
      deltas: context.deltas,
      usage: context.usage,
      finishReason: context.finishReason,
    };
    context.resolve(payload);
  }

  #failContext(context, error) {
    if (context.completed) return;
    this.contextsByConversation.delete(context.clientConversationId);
    if (context.conversationId) {
      this.contextsByConversation.delete(context.conversationId);
    }
    this.contextsByRequest.delete(context.requestId);
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    context.reject(error instanceof Error ? error : new TransportError(String(error)));
  }

  #write(message) {
    if (!this.child?.stdin) {
      throw new TransportError("worker stdin unavailable", {
        code: "worker_unavailable",
        retryable: true,
      });
    }
    const serialized = JSON.stringify(message);
    try {
      this.child.stdin.write(serialized + "\n");
    } catch (err) {
      throw err instanceof Error ? err : new TransportError(String(err));
    }
  }

  #nextRpcId() {
    const next = this.rpcSeq;
    this.rpcSeq += 1;
    if (this.rpcSeq > 2 ** 31) this.rpcSeq = 1;
    return next;
  }

  #extractAdvertisedModels(result) {
    if (!result) return [];
    if (Array.isArray(result)) return result;
    if (Array.isArray(result?.models)) return result.models;
    if (Array.isArray(result?.advertised_models)) return result.advertised_models;
    return [];
  }
}

let transportInstance;

export function getJsonRpcTransport() {
  if (!isAppServerMode()) {
    throw new TransportError("JSON-RPC transport requested while app-server mode disabled", {
      code: "app_server_disabled",
      retryable: false,
    });
  }
  if (!transportInstance) {
    ensureWorkerSupervisor();
    transportInstance = new JsonRpcTransport();
  }
  return transportInstance;
}

export function resetJsonRpcTransport() {
  if (transportInstance) {
    transportInstance.destroy();
    transportInstance = null;
  }
}

export function mapTransportError(err) {
  if (!(err instanceof TransportError)) return null;
  const code = err.code || "transport_error";
  const retryable = err.retryable === true;
  const body = {
    error: {
      message: err.message || "transport error",
      type: retryable ? "backend_unavailable" : "server_error",
      code,
    },
  };
  if (retryable) body.error.retryable = true;

  let statusCode = retryable ? 503 : 500;

  switch (code) {
    case "worker_request_timeout":
      body.error.message = "app-server request timeout";
      body.error.type = "timeout_error";
      body.error.retryable = true;
      statusCode = 504;
      break;
    case "worker_unavailable":
    case "worker_exited":
    case "worker_not_ready":
      body.error.message = err.message || "app-server worker unavailable";
      body.error.type = "backend_unavailable";
      body.error.retryable = true;
      statusCode = 503;
      break;
    case "worker_busy":
      body.error.message = err.message || "app-server worker at capacity";
      body.error.type = "rate_limit_error";
      body.error.retryable = true;
      statusCode = 429;
      break;
    case "request_aborted":
      body.error.message = err.message || "request aborted by client";
      body.error.type = "request_cancelled";
      statusCode = 499;
      delete body.error.retryable;
      break;
    default:
      if (retryable) {
        body.error.type = "backend_unavailable";
        statusCode = 503;
      }
      break;
  }

  return { statusCode, body };
}

export { TransportError };
