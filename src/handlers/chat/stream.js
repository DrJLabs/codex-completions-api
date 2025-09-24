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
  sseErrorBody,
} from "../../lib/errors.js";
import {
  LOG_PROTO,
  appendUsage,
  appendProtoEvent,
  extractUseToolBlocks,
} from "../../dev-logging.js";
import {
  buildProtoArgs,
  createFinishReasonTracker,
  extractFinishReasonFromMessage,
  logFinishReasonTelemetry,
  coerceAssistantContent,
} from "./shared.js";
import { applyGuardHeaders, setupStreamGuard } from "../../services/concurrency-guard.js";

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
const TEST_ENDPOINTS_ENABLED = CFG.PROXY_TEST_ENDPOINTS;

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
  // Global SSE concurrency guard (per-process). Deterministic for tests.
  const MAX_CONC = Number(CFG.PROXY_SSE_MAX_CONCURRENCY || 0) || 0;

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

  const args = buildProtoArgs({
    SANDBOX_MODE,
    effectiveModel,
    FORCE_PROVIDER,
    reasoningEffort,
    allowEffort,
  });

  const prompt = joinMessages(messages);
  const promptTokensEst = estTokensForMessages(messages);
  const MAX_TOKENS = CFG.PROXY_MAX_PROMPT_TOKENS;
  if (MAX_TOKENS > 0 && promptTokensEst > MAX_TOKENS) {
    applyCors(null, res);
    return res.status(403).json(tokensExceededBody("messages"));
  }

  const guardContext = setupStreamGuard({
    res,
    reqId,
    route: "/v1/chat/completions",
    maxConc: MAX_CONC,
    testEndpointsEnabled: TEST_ENDPOINTS_ENABLED,
    send429: () => {
      applyCors(null, res);
      res.status(429).json({
        error: {
          message: "too many concurrent streams",
          type: "rate_limit_error",
          code: "concurrency_exceeded",
        },
      });
    },
  });

  if (!guardContext.acquired) {
    return;
  }

  const releaseGuard = (outcome) => guardContext.release(outcome);
  applyGuardHeaders(res, guardContext.token, TEST_ENDPOINTS_ENABLED);

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

  const onChildError = (e) => {
    try {
      console.log("[proxy] child error:", e?.message || String(e));
    } catch {}
    if (responded) return;
    responded = true;
    try {
      res.write(`data: ${JSON.stringify(sseErrorBody(e))}\n\n`);
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
    releaseGuard();
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
  let finishSent = false;
  let finalized = false;
  let hasToolCallsFlag = false;
  let hasFunctionCall = false;
  const hasToolCallEvidence = () => hasToolCallsFlag || toolCount > 0;
  const unknownFinishReasons = new Set();
  let finalFinishReason = null;
  let finalFinishSource = null;
  let finalFinishTrail = [];
  let finalFinishUnknown = [];
  const finishTracker = createFinishReasonTracker({
    fallback: "stop",
    onUnknown: (info) => {
      const value = info?.value || info?.raw;
      if (value) unknownFinishReasons.add(value);
    },
  });
  const usageState = {
    prompt: 0,
    completion: 0,
    emitted: false,
    logged: false,
    trigger: null,
    countsSource: "estimate",
    providerSupplied: false,
  };
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

  const updateUsageCounts = (trigger, { prompt, completion } = {}, { provider = false } = {}) => {
    const promptNum = Number.isFinite(prompt) ? Number(prompt) : NaN;
    const completionNum = Number.isFinite(completion) ? Number(completion) : NaN;
    let touched = false;
    if (!Number.isNaN(promptNum) && promptNum >= 0) {
      usageState.prompt = provider ? promptNum : Math.max(usageState.prompt, promptNum);
      touched = true;
    }
    if (!Number.isNaN(completionNum) && completionNum >= 0) {
      usageState.completion = provider
        ? completionNum
        : Math.max(usageState.completion, completionNum);
      touched = true;
    }
    if (touched) usageState.countsSource = "event";
    if (!usageState.trigger) usageState.trigger = trigger;
    if (provider) usageState.providerSupplied = true;
  };

  const resolvedCounts = () => {
    const estimatedCompletion = Math.ceil(emitted.length / 4);
    const usingEvent = usageState.countsSource === "event";
    const promptTokens = usingEvent ? usageState.prompt : promptTokensEst;
    const completionTokens = usingEvent ? usageState.completion : estimatedCompletion;
    const totalTokens = promptTokens + completionTokens;
    return { promptTokens, completionTokens, totalTokens, estimatedCompletion };
  };

  const trackToolSignals = (payload) => {
    if (!payload || typeof payload !== "object") return;
    const toolCalls = payload.tool_calls || payload.toolCalls;
    if (Array.isArray(toolCalls) && toolCalls.length) hasToolCallsFlag = true;
    const functionCall = payload.function_call || payload.functionCall;
    if (functionCall && typeof functionCall === "object") hasFunctionCall = true;
    if (payload.message && typeof payload.message === "object") trackToolSignals(payload.message);
    if (payload.delta && typeof payload.delta === "object") trackToolSignals(payload.delta);
    if (Array.isArray(payload.deltas)) {
      for (const delta of payload.deltas) trackToolSignals(delta);
    }
    if (Array.isArray(payload.items)) {
      for (const item of payload.items) trackToolSignals(item);
    }
    if (payload.arguments && typeof payload.arguments === "object") {
      trackToolSignals(payload.arguments);
    }
  };

  const resolveFinishReason = (context = {}) => {
    const resolved = finishTracker.resolve({
      hasToolCalls: hasToolCallEvidence(),
      hasFunctionCall,
      ...context,
    });
    finalFinishReason = resolved.reason;
    finalFinishSource = resolved.source;
    finalFinishTrail = resolved.trail || [];
    finalFinishUnknown = resolved.unknown || [];
    return resolved;
  };

  const emitFinishChunk = (rawReason) => {
    if (finishSent) return finalFinishReason;
    if (rawReason) finishTracker.record(rawReason, "finalizer");
    const { reason } = resolveFinishReason();
    finishSent = true;
    sendChunk({
      choices: [{ index: 0, delta: {}, finish_reason: reason }],
      usage: null,
    });
    return reason;
  };

  const trackFinishReason = (raw, source) => {
    if (raw === null || raw === undefined) return;
    finishTracker.record(raw, source);
  };

  const emitUsageChunk = (trigger) => {
    if (usageState.emitted || !includeUsage) return;
    const { promptTokens, completionTokens, totalTokens } = resolvedCounts();
    usageState.emitted = true;
    sendChunk({
      choices: [],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
        // Story 2.6 placeholders remain
        time_to_first_token: null,
        throughput_after_first_token: null,
        emission_trigger: trigger,
      },
    });
  };

  const logUsage = (trigger) => {
    if (usageState.logged) return;
    const { promptTokens, completionTokens, totalTokens, estimatedCompletion } = resolvedCounts();
    const emittedAtMs = Date.now() - started;
    const resolved = finalFinishReason
      ? { reason: finalFinishReason, source: finalFinishSource }
      : resolveFinishReason();
    try {
      appendUsage({
        ts: Date.now(),
        req_id: reqId,
        route: "/v1/chat/completions",
        method: "POST",
        requested_model: requestedModel,
        effective_model: effectiveModel,
        stream: true,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
        prompt_tokens_est: promptTokensEst,
        completion_tokens_est: estimatedCompletion,
        total_tokens_est: promptTokensEst + estimatedCompletion,
        duration_ms: emittedAtMs,
        status: 200,
        user_agent: req.headers["user-agent"] || "",
        emission_trigger: trigger,
        emitted_at_ms: emittedAtMs,
        counts_source: usageState.countsSource,
        usage_included: includeUsage,
        provider_supplied: usageState.providerSupplied,
        finish_reason: resolved.reason,
        finish_reason_source: resolved.source,
        has_tool_calls: hasToolCallEvidence(),
        has_function_call: hasFunctionCall,
      });
    } catch (e) {
      if (IS_DEV_ENV) console.error("[dev][response][chat][stream] usage log error:", e);
    }
    usageState.logged = true;
  };

  const finalizeStream = ({ reason, trigger } = {}) => {
    if (finalized) return;
    finalized = true;
    const resolvedTrigger =
      trigger ||
      usageState.trigger ||
      (includeUsage ? (finishSent ? "task_complete" : "token_count") : "task_complete");
    if (reason) trackFinishReason(reason, "finalize");
    const resolvedFinish = resolveFinishReason();
    if (!finishSent) emitFinishChunk();
    if (!usageState.emitted && includeUsage) emitUsageChunk(resolvedTrigger);
    if (!usageState.logged) logUsage(resolvedTrigger);
    logFinishReasonTelemetry({
      route: "/v1/chat/completions",
      reqId,
      reason: resolvedFinish.reason,
      source: resolvedFinish.source,
      hasToolCalls: hasToolCallEvidence(),
      hasFunctionCall,
      unknownReasons: finalFinishUnknown.length
        ? finalFinishUnknown
        : Array.from(unknownFinishReasons),
      trail: finalFinishTrail,
    });
    try {
      finishSSE();
    } catch {}
    cleanupStream();
    try {
      child.kill("SIGTERM");
    } catch {}
  };

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
        const payload = evt.msg || evt;
        if (payload) {
          trackToolSignals(payload);
          const finishCandidate = extractFinishReasonFromMessage(payload);
          if (finishCandidate) trackFinishReason(finishCandidate, t || "event");
        }
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
          const messagePayload = evt.msg?.message ?? evt.message;
          if (typeof messagePayload === "string") {
            const m = messagePayload;
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
          } else if (messagePayload && typeof messagePayload === "object") {
            const text = coerceAssistantContent(
              messagePayload.content ?? messagePayload.text ?? ""
            );
            if (text) {
              let suffix = "";
              if (text.startsWith(emitted)) suffix = text.slice(emitted.length);
              else if (!sentAny) suffix = text;
              if (suffix) {
                emitted += suffix;
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
              }
            }
          }
        } else if (t === "token_count") {
          const promptTokens = Number(evt.msg?.prompt_tokens ?? evt.msg?.promptTokens);
          const completionTokens = Number(evt.msg?.completion_tokens ?? evt.msg?.completionTokens);
          updateUsageCounts("token_count", { prompt: promptTokens, completion: completionTokens });
          const tokenFinishReason = extractFinishReasonFromMessage(evt.msg);
          if (tokenFinishReason) trackFinishReason(tokenFinishReason, "token_count");
        } else if (t === "usage") {
          const promptTokens = Number(
            evt.msg?.prompt_tokens ?? evt.msg?.usage?.prompt_tokens ?? evt.usage?.prompt_tokens
          );
          const completionTokens = Number(
            evt.msg?.completion_tokens ??
              evt.msg?.usage?.completion_tokens ??
              evt.usage?.completion_tokens
          );
          updateUsageCounts(
            "provider",
            { prompt: promptTokens, completion: completionTokens },
            { provider: true }
          );
        } else if (t === "task_complete") {
          const finishReason =
            extractFinishReasonFromMessage(evt.msg) ||
            (usageState.trigger === "token_count" ? "length" : null);
          if (finishReason) trackFinishReason(finishReason, "task_complete");
          const promptTokens = Number(
            evt.msg?.prompt_tokens ?? evt.msg?.token_count?.prompt_tokens
          );
          const completionTokens = Number(
            evt.msg?.completion_tokens ?? evt.msg?.token_count?.completion_tokens
          );
          if (Number.isFinite(promptTokens) || Number.isFinite(completionTokens)) {
            updateUsageCounts(usageState.trigger || "task_complete", {
              prompt: promptTokens,
              completion: completionTokens,
            });
          } else if (!usageState.trigger) {
            usageState.trigger = "task_complete";
          }
          emitFinishChunk(finishReason || undefined);
          finalizeStream({ reason: finishReason, trigger: usageState.trigger || "task_complete" });
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
    if (finalized) return;
    if (!sentAny) {
      const content = stripAnsi(out).trim() || "No output from backend.";
      sendChunk({
        choices: [{ index: 0, delta: { content }, finish_reason: null }],
        usage: null,
      });
      sentAny = true;
      if (IS_DEV_ENV) {
        try {
          console.log("[dev][response][chat][stream] content=\n" + content);
        } catch (e) {
          console.error("[dev][response][chat][stream] error:", e);
        }
      }
    }
    const trigger = usageState.trigger || (includeUsage ? "token_count" : "close");
    const inferredReason = finishSent
      ? finalFinishReason
      : usageState.trigger === "token_count"
        ? "length"
        : "stop";
    finalizeStream({ reason: inferredReason, trigger });
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

  const guardContext = setupStreamGuard({
    res,
    reqId,
    route: "/v1/completions",
    maxConc: MAX_CONC,
    testEndpointsEnabled: TEST_ENDPOINTS_ENABLED,
    send429: () => {
      applyCors(null, res);
      res.status(429).json({
        error: {
          message: "too many concurrent streams",
          type: "rate_limit_error",
          code: "concurrency_exceeded",
        },
      });
    },
  });

  if (!guardContext.acquired) {
    return;
  }

  const releaseGuard = (outcome) => guardContext.release(outcome);
  applyGuardHeaders(res, guardContext.token, TEST_ENDPOINTS_ENABLED);

  const child = spawnCodex(args);
  const onChildError = (e) => {
    try {
      console.log("[proxy] child error (completions):", e?.message || String(e));
    } catch {}
    if (responded) return;
    responded = true;
    try {
      sendSSEUtil(res, sseErrorBody(e));
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
    releaseGuard();
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
    releaseGuard("released:child_close");
  });
}
