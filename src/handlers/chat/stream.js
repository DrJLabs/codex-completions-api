import { spawnCodex, resolvedCodexBin } from "../../services/codex-runner.js";
import {
  setSSEHeaders,
  computeKeepaliveMs,
  startKeepalives,
  sendSSE as sendSSEUtil,
  finishSSE as finishSSEUtil,
} from "../../services/sse.js";
import { nanoid } from "nanoid";
import {
  stripAnsi,
  estTokensForMessages,
  joinMessages,
  impliedEffortForModel,
  normalizeModel,
  applyCors as applyCorsUtil,
} from "../../utils.js";
import { config as CFG } from "../../config/index.js";
import { acceptedModelIds } from "../../config/models.js";
import {
  authErrorBody,
  modelNotFoundBody,
  invalidRequestBody,
  tokensExceededBody,
} from "../../lib/errors.js";
import {
  LOG_PROTO,
  appendUsage,
  appendProtoEvent,
  extractUseToolBlocks,
} from "../../dev-logging.js";
import { buildProtoArgs } from "./shared.js";

const API_KEY = CFG.API_KEY;
const DEFAULT_MODEL = CFG.CODEX_MODEL;
const SANDBOX_MODE = CFG.PROXY_SANDBOX_MODE;
const FORCE_PROVIDER = CFG.CODEX_FORCE_PROVIDER.trim();
const IS_DEV_ENV = (CFG.PROXY_ENV || "").toLowerCase() === "dev";
const ACCEPTED_MODEL_IDS = acceptedModelIds(DEFAULT_MODEL);
const STOP_AFTER_TOOLS = CFG.PROXY_STOP_AFTER_TOOLS;
const STOP_AFTER_TOOLS_MODE = CFG.PROXY_STOP_AFTER_TOOLS_MODE;
const STOP_AFTER_TOOLS_GRACE_MS = Number(process.env.PROXY_STOP_AFTER_TOOLS_GRACE_MS || 300);
const STOP_AFTER_TOOLS_MAX = Number(process.env.PROXY_TOOL_BLOCK_MAX || 0);
const SUPPRESS_TAIL_AFTER_TOOLS = CFG.PROXY_SUPPRESS_TAIL_AFTER_TOOLS;
const REQ_TIMEOUT_MS = CFG.PROXY_TIMEOUT_MS;
const KILL_ON_DISCONNECT = CFG.PROXY_KILL_ON_DISCONNECT.toLowerCase() !== "false";
const STREAM_IDLE_TIMEOUT_MS = CFG.PROXY_STREAM_IDLE_TIMEOUT_MS;
const DEBUG_PROTO = /^(1|true|yes)$/i.test(String(CFG.PROXY_DEBUG_PROTO || ""));
const CORS_ENABLED = CFG.PROXY_ENABLE_CORS.toLowerCase() !== "false";
const applyCors = (req, res) => applyCorsUtil(req, res, CORS_ENABLED);

// POST /v1/chat/completions with stream=true
export async function postChatStream(req, res) {
  const reqId = nanoid();
  const started = Date.now();
  let responded = false;
  let responseWritable = true;

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token !== API_KEY) {
    applyCors(null, res);
    return res.status(401).set("WWW-Authenticate", "Bearer realm=api").json(authErrorBody());
  }
  // Global SSE concurrency guard (per-process). Simpler and more deterministic for tests
  const MAX_CONC = Number(CFG.PROXY_SSE_MAX_CONCURRENCY || 0) || 0;
  globalThis.__sseConcCount = globalThis.__sseConcCount || 0;
  let acquiredConc = false;

  const body = req.body || {};
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) {
    applyCors(null, res);
    return res.status(400).json({
      error: {
        message: "messages[] required",
        type: "invalid_request_error",
        param: "messages",
        code: "invalid_request_error",
      },
    });
  }

  // n>1 not supported in this epic scope
  const n = Number(body.n || 0);
  if (n > 1) {
    applyCors(null, res);
    return res.status(400).json(invalidRequestBody("n", "n>1 is unsupported"));
  }

  const { requested: requestedModel, effective: effectiveModel } = normalizeModel(
    body.model || DEFAULT_MODEL,
    DEFAULT_MODEL,
    Array.from(ACCEPTED_MODEL_IDS)
  );
  try {
    console.log(
      `[proxy] model requested=${requestedModel} effective=${effectiveModel} stream=${!!body.stream}`
    );
  } catch {}
  if (body.model && !ACCEPTED_MODEL_IDS.has(requestedModel)) {
    applyCors(null, res);
    return res.status(404).json(modelNotFoundBody(requestedModel));
  }
  let reasoningEffort = (
    body.reasoning?.effort ||
    body.reasoning_effort ||
    body.reasoningEffort ||
    ""
  )
    .toString()
    .toLowerCase();
  const allowEffort = new Set(["low", "medium", "high", "minimal"]);
  if (!reasoningEffort) {
    const implied = impliedEffortForModel(requestedModel);
    if (implied) reasoningEffort = implied;
  }

  // Acquire concurrency slot only after validations pass
  if (MAX_CONC > 0) {
    if (globalThis.__sseConcCount >= MAX_CONC) {
      applyCors(null, res);
      return res.status(429).json({
        error: {
          message: "too many concurrent streams",
          type: "rate_limit_error",
          code: "concurrency_exceeded",
        },
      });
    }
    globalThis.__sseConcCount += 1;
    acquiredConc = true;
  }

  const args = buildProtoArgs({
    SANDBOX_MODE,
    effectiveModel,
    FORCE_PROVIDER,
    reasoningEffort,
    allowEffort,
  });

  const prompt = joinMessages(messages);
  const promptTokensEst = estTokensForMessages(messages);
  const MAX_TOKENS = Number(CFG.PROXY_MAX_PROMPT_TOKENS || 0);
  if (MAX_TOKENS > 0 && promptTokensEst > MAX_TOKENS) {
    applyCors(null, res);
    return res.status(403).json(tokensExceededBody("messages"));
  }

  if (IS_DEV_ENV) {
    try {
      console.log("[dev][prompt][chat] messages=", JSON.stringify(messages));
      console.log("[dev][prompt][chat] joined=\n" + prompt);
      appendProtoEvent({
        ts: Date.now(),
        req_id: reqId,
        route: "/v1/chat/completions",
        mode: "chat",
        kind: "submission",
        payload: { messages, joined: prompt },
      });
    } catch (e) {
      console.error("[dev][prompt][chat] error:", e);
    }
  }

  try {
    console.log(
      "[proxy] spawning (proto):",
      resolvedCodexBin,
      args.join(" "),
      " prompt_len=",
      prompt.length
    );
  } catch {}
  const child = spawnCodex(args);

  const sseErrorPayload = (e) => {
    const raw = (e && e.message) || "spawn error";
    const isTimeout = /timeout/i.test(raw);
    return {
      error: {
        message: isTimeout ? "request timeout" : raw,
        type: isTimeout ? "timeout_error" : "server_error",
        code: isTimeout ? "request_timeout" : "spawn_error",
      },
    };
  };

  const onChildError = (e) => {
    try {
      console.log("[proxy] child error:", e?.message || String(e));
    } catch {}
    if (responded) return;
    responded = true;
    try {
      res.write(`data: ${JSON.stringify(sseErrorPayload(e))}\n\n`);
    } catch {}
    try {
      res.write("data: [DONE]\n\n");
      res.end();
    } catch {}
  };
  child.on("error", onChildError);
  const timeout = setTimeout(() => {
    if (responded) return;
    onChildError(new Error("request timeout"));
    try {
      child.kill("SIGKILL");
    } catch {}
  }, REQ_TIMEOUT_MS);

  let out = "";

  const sendSSE = (payload) => {
    try {
      if (!responseWritable) return;
      sendSSEUtil(res, payload);
    } catch {}
  };
  const sendSSEKeepalive = () => {
    res.write(`: keepalive ${Date.now()}\n\n`);
  };
  const finishSSE = () => {
    finishSSEUtil(res);
  };

  // Stable id across stream
  const completionId = `chatcmpl-${nanoid()}`;
  const created = Math.floor(Date.now() / 1000);
  const sendChunk = (payload) => {
    sendSSE({
      id: completionId,
      object: "chat.completion.chunk",
      created,
      model: requestedModel,
      ...payload,
    });
  };
  const sendRoleOnce = (() => {
    let sent = false;
    return () => {
      if (sent) return;
      sent = true;
      sendChunk({
        choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
        usage: null,
      });
    };
  })();
  setSSEHeaders(res);

  let keepalive;
  let streamClosed = false;
  const keepaliveMs = computeKeepaliveMs(req);
  const clearKeepalive = () => {
    if (keepalive) {
      try {
        if (typeof keepalive.stop === "function") keepalive.stop();
        else clearInterval(keepalive);
      } catch {}
      keepalive = null;
    }
  };
  const cleanupStream = () => {
    if (streamClosed) return;
    streamClosed = true;
    clearKeepalive();
    responseWritable = false;
    try {
      clearTimeout(timeout);
    } catch {}
    try {
      if (KILL_ON_DISCONNECT) child.kill("SIGTERM");
    } catch {}
    try {
      if (MAX_CONC > 0 && acquiredConc)
        globalThis.__sseConcCount = Math.max(0, (globalThis.__sseConcCount || 1) - 1);
    } catch {}
  };
  if (keepaliveMs > 0)
    keepalive = startKeepalives(res, keepaliveMs, () => {
      try {
        if (!streamClosed) sendSSEKeepalive();
      } catch {}
    });
  res.on("close", cleanupStream);
  res.on("finish", cleanupStream);
  req.on?.("aborted", cleanupStream);

  sendRoleOnce();
  let buf = "";
  let sentAny = false;
  let emitted = "";
  let forwardedUpTo = 0;
  let scanPos = 0;
  let toolCount = 0;
  let lastToolEnd = -1;
  let cutTimer = null;
  let stoppedAfterTools = false;
  const includeUsage = !!(body?.stream_options?.include_usage || body?.include_usage);
  let ptCount = 0,
    ctCount = 0;
  let streamIdleTimer;
  const resetStreamIdle = () => {
    if (streamIdleTimer) clearTimeout(streamIdleTimer);
    streamIdleTimer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {}
    }, STREAM_IDLE_TIMEOUT_MS);
  };
  resetStreamIdle();

  child.stdout.on("data", (chunk) => {
    resetStreamIdle();
    const s = chunk.toString("utf8");
    out += s;
    buf += s;
    if (LOG_PROTO) {
      appendProtoEvent({
        ts: Date.now(),
        req_id: reqId,
        route: "/v1/chat/completions",
        mode: "chat_stream",
        kind: "stdout",
        chunk: s,
      });
    }
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const evt = JSON.parse(trimmed);
        const t = (evt && (evt.msg?.type || evt.type)) || "";
        appendProtoEvent({
          ts: Date.now(),
          req_id: reqId,
          route: "/v1/chat/completions",
          mode: "chat_stream",
          kind: "event",
          event: evt,
        });
        if (t === "agent_message_delta") {
          const d = String((evt.msg?.delta ?? evt.delta) || "");
          if (d) {
            emitted += d;
            // Parse for tool blocks; update lastToolEnd and toolCount
            try {
              const { blocks, nextPos } = extractUseToolBlocks(emitted, scanPos);
              if (blocks && blocks.length) {
                toolCount += blocks.length;
                lastToolEnd = blocks[blocks.length - 1].end;
                scanPos = nextPos;
              }
            } catch {}
            // Determine how far we are allowed to forward
            let allowUntil = emitted.length;
            if ((SUPPRESS_TAIL_AFTER_TOOLS || STOP_AFTER_TOOLS) && lastToolEnd >= 0) {
              allowUntil = lastToolEnd;
            }
            const segment = emitted.slice(forwardedUpTo, allowUntil);
            if (segment) {
              sendChunk({
                choices: [{ index: 0, delta: { content: segment }, finish_reason: null }],
                usage: null,
              });
              sentAny = true;
              forwardedUpTo = allowUntil;
            }
            // Early cut behavior
            if (STOP_AFTER_TOOLS && toolCount > 0 && !stoppedAfterTools) {
              const cutNow = () => {
                if (stoppedAfterTools) return;
                stoppedAfterTools = true;
                try {
                  clearKeepalive();
                } catch {}
                try {
                  finishSSE();
                } catch {}
                try {
                  child.kill("SIGTERM");
                } catch {}
              };
              if (STOP_AFTER_TOOLS_MAX > 0 && toolCount >= STOP_AFTER_TOOLS_MAX) {
                cutNow();
              } else if (STOP_AFTER_TOOLS_MODE === "first") {
                cutNow();
              } else {
                try {
                  if (cutTimer) clearTimeout(cutTimer);
                } catch {}
                cutTimer = setTimeout(cutNow, Math.max(0, STOP_AFTER_TOOLS_GRACE_MS));
              }
            }
          }
        } else if (t === "agent_message") {
          const m = String((evt.msg?.message ?? evt.message) || "");
          if (m) {
            let suffix = "";
            if (m.startsWith(emitted)) suffix = m.slice(emitted.length);
            else if (!sentAny) suffix = m;
            if (suffix) {
              emitted += suffix;
              // Update tool blocks
              try {
                const { blocks, nextPos } = extractUseToolBlocks(emitted, scanPos);
                if (blocks && blocks.length) {
                  toolCount += blocks.length;
                  lastToolEnd = blocks[blocks.length - 1].end;
                  scanPos = nextPos;
                }
              } catch {}
              let allowUntil = emitted.length;
              if ((SUPPRESS_TAIL_AFTER_TOOLS || STOP_AFTER_TOOLS) && lastToolEnd >= 0) {
                allowUntil = lastToolEnd;
              }
              const segment = emitted.slice(forwardedUpTo, allowUntil);
              if (segment) {
                sendChunk({
                  choices: [{ index: 0, delta: { content: segment }, finish_reason: null }],
                  usage: null,
                });
                sentAny = true;
                forwardedUpTo = allowUntil;
              }
              if (STOP_AFTER_TOOLS && toolCount > 0 && !stoppedAfterTools) {
                const cutNow = () => {
                  if (stoppedAfterTools) return;
                  stoppedAfterTools = true;
                  try {
                    clearKeepalive();
                  } catch {}
                  try {
                    finishSSE();
                  } catch {}
                  try {
                    child.kill("SIGTERM");
                  } catch {}
                };
                if (STOP_AFTER_TOOLS_MAX > 0 && toolCount >= STOP_AFTER_TOOLS_MAX) cutNow();
                else if (STOP_AFTER_TOOLS_MODE === "first") cutNow();
                else {
                  try {
                    if (cutTimer) clearTimeout(cutTimer);
                  } catch {}
                  cutTimer = setTimeout(cutNow, Math.max(0, STOP_AFTER_TOOLS_GRACE_MS));
                }
              }
            }
          }
        } else if (t === "token_count") {
          // Record counts but do NOT emit usage yet; per OpenAI parity
          // we send the finish_reason chunk first, then the final usage chunk.
          ptCount = Number(evt.msg?.prompt_tokens || 0);
          ctCount = Number(evt.msg?.completion_tokens || 0);
        } else if (t === "task_complete") {
          try {
            if (IS_DEV_ENV) {
              try {
                console.log("[dev][response][chat][stream] content=\n" + emitted);
              } catch (e) {
                console.error("[dev][response][chat][stream] error:", e);
              }
            }
            appendUsage({
              ts: Date.now(),
              req_id: reqId,
              route: "/v1/chat/completions",
              method: "POST",
              requested_model: requestedModel,
              effective_model: effectiveModel,
              stream: true,
              prompt_tokens_est: ptCount || promptTokensEst,
              completion_tokens_est: ctCount || Math.ceil(emitted.length / 4),
              total_tokens_est:
                (ptCount || promptTokensEst) + (ctCount || Math.ceil(emitted.length / 4)),
              duration_ms: Date.now() - started,
              status: 200,
              user_agent: req.headers["user-agent"] || "",
            });
          } catch (e) {
            if (IS_DEV_ENV) console.error("[dev][response][chat][stream] usage error:", e);
          }
          // Emit a finalizer chunk with finish_reason, then optional usage chunk
          sendChunk({
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: null,
          });
          if (includeUsage) {
            const p = ptCount || promptTokensEst;
            const c = ctCount || Math.ceil(emitted.length / 4);
            sendChunk({
              choices: [],
              usage: {
                prompt_tokens: p,
                completion_tokens: c,
                total_tokens: p + c,
              },
            });
          }
          try {
            finishSSE();
          } catch {}
          try {
            child.kill("SIGTERM");
          } catch {}
          return;
        } else if (t === "error") {
          if (DEBUG_PROTO)
            try {
              console.log("[proto] error event");
            } catch {}
        }
      } catch {
        if (DEBUG_PROTO)
          try {
            console.log("[proto] parse error line:", trimmed);
          } catch {}
      }
    }
  });
  child.stderr.on("data", (e) => {
    try {
      appendProtoEvent({
        ts: Date.now(),
        req_id: reqId,
        route: "/v1/chat/completions",
        mode: "chat_stream",
        kind: "stderr",
        chunk: e.toString("utf8"),
      });
    } catch {}
  });
  try {
    const submission = {
      id: reqId,
      op: { type: "user_input", items: [{ type: "text", text: prompt }] },
    };
    child.stdin.write(JSON.stringify(submission) + "\n");
  } catch {}
  child.on("close", () => {
    if (!sentAny) {
      const content = stripAnsi(out).trim() || "No output from backend.";
      sendChunk({
        choices: [{ index: 0, delta: { content }, finish_reason: null }],
        usage: null,
      });
      if (IS_DEV_ENV) {
        try {
          console.log("[dev][response][chat][stream] content=\n" + content);
        } catch (e) {
          console.error("[dev][response][chat][stream] error:", e);
        }
      }
    }
    finishSSE();
    cleanupStream();
  });
}

// POST /v1/completions with stream=true (legacy shim that maps to proto)
export async function postCompletionsStream(req, res) {
  try {
    console.log("[completions] POST /v1/completions received");
  } catch {}
  const reqId = nanoid();
  const started = Date.now();
  let responded = false;
  let responseWritable = true;

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token !== API_KEY) {
    applyCors(null, res);
    return res.status(401).set("WWW-Authenticate", "Bearer realm=api").json(authErrorBody());
  }

  // Concurrency guard for legacy completions stream as well
  const MAX_CONC = Number(CFG.PROXY_SSE_MAX_CONCURRENCY || 0) || 0;
  globalThis.__sseConcCount = globalThis.__sseConcCount || 0;
  let acquiredConc = false;

  const body = req.body || {};
  const prompt = Array.isArray(body.prompt) ? body.prompt.join("\n") : body.prompt || "";
  if (IS_DEV_ENV) {
    try {
      console.log("[dev][prompt][completions] prompt=\n" + prompt);
      appendProtoEvent({
        ts: Date.now(),
        req_id: reqId,
        route: "/v1/completions",
        mode: "completions",
        kind: "submission",
        payload: { prompt },
      });
    } catch (e) {
      console.error("[dev][prompt][completions] error:", e);
    }
  }
  if (!prompt) {
    applyCors(null, res);
    return res.status(400).json({
      error: {
        message: "prompt required",
        type: "invalid_request_error",
        param: "prompt",
        code: "invalid_request_error",
      },
    });
  }

  const { requested: requestedModel, effective: effectiveModel } = normalizeModel(
    body.model || DEFAULT_MODEL,
    DEFAULT_MODEL,
    Array.from(ACCEPTED_MODEL_IDS)
  );
  try {
    console.log(
      `[proxy] completions model requested=${requestedModel} effective=${effectiveModel} stream=${!!body.stream}`
    );
  } catch {}
  if (body.model && !ACCEPTED_MODEL_IDS.has(requestedModel)) {
    applyCors(null, res);
    return res.status(404).json(modelNotFoundBody(requestedModel));
  }

  let reasoningEffort = (
    body.reasoning?.effort ||
    body.reasoning_effort ||
    body.reasoningEffort ||
    ""
  )
    .toString()
    .toLowerCase();
  const allowEffort = new Set(["low", "medium", "high", "minimal"]);
  if (!reasoningEffort) {
    const implied = impliedEffortForModel(requestedModel);
    if (implied) reasoningEffort = implied;
  }

  const args = buildProtoArgs({
    SANDBOX_MODE,
    effectiveModel,
    FORCE_PROVIDER,
    reasoningEffort,
    allowEffort,
  });

  const messages = [{ role: "user", content: prompt }];
  const toSend = joinMessages(messages);
  const promptTokensEst = estTokensForMessages(messages);

  try {
    console.log(
      "[proxy] spawning (proto completions):",
      resolvedCodexBin,
      args.join(" "),
      " prompt_len=",
      toSend.length
    );
  } catch {}

  const child = spawnCodex(args);
  const sseErrorPayload = (e) => {
    const raw = (e && e.message) || "spawn error";
    const isTimeout = /timeout/i.test(raw);
    return {
      error: {
        message: isTimeout ? "request timeout" : raw,
        type: isTimeout ? "timeout_error" : "server_error",
        code: isTimeout ? "request_timeout" : "spawn_error",
      },
    };
  };
  const onChildError = (e) => {
    try {
      console.log("[proxy] child error (completions):", e?.message || String(e));
    } catch {}
    if (responded) return;
    responded = true;
    try {
      sendSSEUtil(res, sseErrorPayload(e));
    } catch {}
    try {
      finishSSEUtil(res);
    } catch {}
  };
  child.on("error", onChildError);

  const timeout = setTimeout(() => {
    if (responded) return;
    onChildError(new Error("request timeout"));
    try {
      child.kill("SIGKILL");
    } catch {}
  }, REQ_TIMEOUT_MS);

  let idleTimerCompletions;
  const resetIdleCompletions = () => {
    if (idleTimerCompletions) clearTimeout(idleTimerCompletions);
    idleTimerCompletions = setTimeout(() => {
      if (responded) return;
      try {
        console.log("[proxy] completions idle timeout; terminating child");
      } catch {}
      try {
        res.write(
          `data: ${JSON.stringify({ error: { message: "backend idle timeout", type: "timeout_error", code: "idle_timeout" } })}\n\n`
        );
      } catch {}
      try {
        res.write("data: [DONE]\n\n");
        res.end();
      } catch {}
      responded = true;
      try {
        child.kill("SIGTERM");
      } catch {}
    }, STREAM_IDLE_TIMEOUT_MS);
  };
  resetIdleCompletions();
  req.on("close", () => {
    if (responded) return;
    if (KILL_ON_DISCONNECT) {
      try {
        child.kill("SIGTERM");
      } catch {}
    }
  });

  try {
    const submission = {
      id: reqId,
      op: { type: "user_input", items: [{ type: "text", text: toSend }] },
    };
    child.stdin.write(JSON.stringify(submission) + "\n");
  } catch {}

  let out = "";
  const completionId = `cmpl-${nanoid()}`;
  const created = Math.floor(Date.now() / 1000);
  const sendSSE = (payload) => {
    try {
      if (!responseWritable) return;
      sendSSEUtil(res, payload);
    } catch {}
  };
  const sendChunk = (payload) => {
    sendSSE({
      id: completionId,
      object: "text_completion.chunk",
      created,
      model: requestedModel,
      ...payload,
    });
  };
  const finishSSE = () => {
    try {
      finishSSEUtil(res);
    } catch {}
  };

  setSSEHeaders(res);

  // Keepalives (parity with chat stream)
  let keepalive;
  let streamClosed = false;
  const keepaliveMs = computeKeepaliveMs(req);
  const clearKeepalive = () => {
    if (keepalive) {
      try {
        if (typeof keepalive.stop === "function") keepalive.stop();
        else clearInterval(keepalive);
      } catch {}
      keepalive = null;
    }
  };
  const cleanupStream = () => {
    if (streamClosed) return;
    streamClosed = true;
    clearKeepalive();
    responseWritable = false;
    try {
      clearTimeout(timeout);
    } catch {}
    try {
      if (KILL_ON_DISCONNECT) child.kill("SIGTERM");
    } catch {}
    try {
      if (MAX_CONC > 0 && acquiredConc)
        globalThis.__sseConcCount = Math.max(0, (globalThis.__sseConcCount || 1) - 1);
    } catch {}
  };
  if (keepaliveMs > 0)
    keepalive = startKeepalives(res, keepaliveMs, () => {
      try {
        if (!streamClosed) res.write(`: keepalive ${Date.now()}\n\n`);
      } catch {}
    });
  res.on("close", cleanupStream);
  res.on("finish", cleanupStream);
  req.on?.("aborted", cleanupStream);

  let buf = "";
  let sentAny = false;
  let emitted = "";
  let completionChars = 0;
  const toolStateC = { pos: 0, idx: 0 };

  child.stdout.on("data", (d) => {
    resetIdleCompletions();
    const s = d.toString("utf8");
    out += s;
    buf += s;
    if (LOG_PROTO)
      appendProtoEvent({
        ts: Date.now(),
        req_id: reqId,
        route: "/v1/completions",
        mode: "completions_stream",
        kind: "stdout",
        chunk: s,
      });
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      const t = line.trim();
      if (!t) continue;
      try {
        const evt = JSON.parse(t);
        const tp = (evt && (evt.msg?.type || evt.type)) || "";
        appendProtoEvent({
          ts: Date.now(),
          req_id: reqId,
          route: "/v1/completions",
          mode: "completions_stream",
          kind: "event",
          event: evt,
        });
        if (tp === "agent_message_delta") {
          const dlt = String((evt.msg?.delta ?? evt.delta) || "");
          if (dlt) {
            sentAny = true;
            emitted += dlt;
            completionChars += dlt.length;
            sendChunk({ choices: [{ index: 0, text: dlt }] });
            const { blocks, nextPos } = extractUseToolBlocks(emitted, toolStateC.pos);
            toolStateC.pos = nextPos;
            if (blocks && blocks.length) {
              // emit proto events for tools for debugging
              for (const b of blocks) {
                appendProtoEvent({
                  ts: Date.now(),
                  req_id: reqId,
                  route: "/v1/completions",
                  mode: "completions_stream",
                  kind: "tool_block",
                  idx: ++toolStateC.idx,
                  char_start: b.start,
                  char_end: b.end,
                  tool: b.name,
                  path: b.path,
                  query: b.query,
                });
              }
            }
          }
        } else if (tp === "agent_message") {
          const m = String((evt.msg?.message ?? evt.message) || "");
          if (m) {
            let suffix = "";
            if (m.startsWith(emitted)) suffix = m.slice(emitted.length);
            else if (!sentAny) suffix = m;
            if (suffix) {
              sentAny = true;
              emitted += suffix;
              completionChars += suffix.length;
              sendChunk({ choices: [{ index: 0, text: suffix }] });
              const { blocks, nextPos } = extractUseToolBlocks(emitted, toolStateC.pos);
              toolStateC.pos = nextPos;
              for (const b of blocks || []) {
                appendProtoEvent({
                  ts: Date.now(),
                  req_id: reqId,
                  route: "/v1/completions",
                  mode: "completions_stream",
                  kind: "tool_block",
                  idx: ++toolStateC.idx,
                  char_start: b.start,
                  char_end: b.end,
                  tool: b.name,
                  path: b.path,
                  query: b.query,
                });
              }
            }
          }
        } else if (tp === "token_count") {
          // no-op for legacy completions stream; emit in close
        } else if (tp === "task_complete") {
          clearTimeout(timeout);
          if (!sentAny) {
            const content = stripAnsi(out).trim() || "No output from backend.";
            sendChunk({ choices: [{ index: 0, text: content }] });
          }
          if (IS_DEV_ENV && sentAny) {
            try {
              console.log("[dev][response][completions][stream] content=\n" + emitted);
            } catch (e) {
              console.error("[dev][response][completions][stream] error:", e);
            }
          }
          const completion_tokens_est = Math.ceil(completionChars / 4);
          if (LOG_PROTO) {
            try {
              const { blocks } = extractUseToolBlocks(emitted, toolStateC.pos);
              for (const b of blocks || []) {
                appendProtoEvent({
                  ts: Date.now(),
                  req_id: reqId,
                  route: "/v1/completions",
                  mode: "completions_stream",
                  kind: "tool_block",
                  idx: ++toolStateC.idx,
                  char_start: b.start,
                  char_end: b.end,
                  tool: b.name,
                  path: b.path,
                  query: b.query,
                });
              }
            } catch {}
          }
          appendUsage({
            ts: Date.now(),
            req_id: reqId,
            route: "/v1/completions",
            method: "POST",
            requested_model: requestedModel,
            effective_model: effectiveModel,
            stream: true,
            prompt_tokens_est: promptTokensEst,
            completion_tokens_est,
            total_tokens_est: promptTokensEst + completion_tokens_est,
            duration_ms: Date.now() - started,
            status: 200,
            user_agent: req.headers["user-agent"] || "",
          });
          finishSSE();
          return;
        }
      } catch {}
    }
  });
  child.stderr.on("data", (e) => {
    resetIdleCompletions();
    const s = e.toString("utf8");
    try {
      console.log("[proxy] child stderr:", s.trim());
    } catch {}
    if (LOG_PROTO)
      appendProtoEvent({
        ts: Date.now(),
        req_id: reqId,
        route: "/v1/completions",
        mode: "completions_stream",
        kind: "stderr",
        chunk: s,
      });
  });
  child.on("close", (_code) => {
    clearTimeout(timeout);
    if (idleTimerCompletions) clearTimeout(idleTimerCompletions);
    // If not completed via task_complete, still finish stream
    if (!sentAny) {
      const content = stripAnsi(out).trim() || "No output from backend.";
      sendChunk({ choices: [{ index: 0, text: content }] });
    }
    finishSSE();
    // release slot if acquired
    try {
      if (MAX_CONC > 0 && acquiredConc)
        globalThis.__sseConcCount = Math.max(0, (globalThis.__sseConcCount || 1) - 1);
    } catch {}
  });
}
