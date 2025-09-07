import express from "express";
import { spawn } from "node:child_process";
import { nanoid } from "nanoid";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  stripAnsi,
  estTokens,
  estTokensForMessages,
  joinMessages,
  parseTime,
  aggregateUsage,
  impliedEffortForModel,
  normalizeModel,
  applyCors as applyCorsUtil,
} from "./src/utils.js";
import {
  LOG_PROTO,
  TOKEN_LOG_PATH,
  appendUsage,
  appendProtoEvent,
  extractUseToolBlocks,
} from "./src/dev-logging.js";
// Simple CORS without extra dependency
const CORS_ENABLED = (process.env.PROXY_ENABLE_CORS || "true").toLowerCase() !== "false";
const applyCors = (req, res) => applyCorsUtil(req, res, CORS_ENABLED);

const app = express();
app.use(express.json({ limit: "16mb" }));
// Global CORS headers
app.use((req, res, next) => {
  applyCors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  next();
});

// Minimal HTTP access logging to aid debugging integrations (e.g., Cursor)
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    try {
      const ua = req.headers["user-agent"] || "";
      const auth = req.headers.authorization ? "present" : "none";
      const dur = Date.now() - start;
      console.log(
        `[http] ${req.method} ${req.originalUrl} -> ${res.statusCode} auth=${auth} ua="${ua}" dur_ms=${dur}`
      );
    } catch {}
  });
  next();
});

const PORT = Number(process.env.PORT || 11435);
const API_KEY = process.env.PROXY_API_KEY || "codex-local-secret";
const DEFAULT_MODEL = process.env.CODEX_MODEL || "gpt-5";
const CODEX_BIN = process.env.CODEX_BIN || "codex";
const RESOLVED_CODEX_BIN = path.isAbsolute(CODEX_BIN)
  ? CODEX_BIN
  : CODEX_BIN.includes(path.sep)
    ? path.join(process.cwd(), CODEX_BIN)
    : CODEX_BIN;
// Allow isolating Codex CLI configuration per deployment. When set, child processes
// receive CODEX_HOME so Codex reads config from `${CODEX_HOME}/config.toml`.
// Default to a dedicated directory `~/.codex-api` so interactive CLI (`~/.codex`) remains separate.
const CODEX_HOME = process.env.CODEX_HOME || path.join(process.cwd(), ".codex-api");
const SANDBOX_MODE = (process.env.PROXY_SANDBOX_MODE || "danger-full-access").toLowerCase();
const CODEX_WORKDIR = process.env.PROXY_CODEX_WORKDIR || path.join(os.tmpdir(), "codex-work");
// const STREAM_MODE = (process.env.PROXY_STREAM_MODE || "incremental").toLowerCase(); // no longer used; streaming handled per-request
const FORCE_PROVIDER = (process.env.CODEX_FORCE_PROVIDER || "").trim();
const REASONING_VARIANTS = ["low", "medium", "high", "minimal"];
const IS_DEV_ENV = (process.env.PROXY_ENV || "").toLowerCase() === "dev";
const DEV_ADVERTISED_IDS = ["codev-5", ...REASONING_VARIANTS.map((v) => `codev-5-${v}`)];
const PROD_ADVERTISED_IDS = ["codex-5", ...REASONING_VARIANTS.map((v) => `codex-5-${v}`)];
const PUBLIC_MODEL_IDS = IS_DEV_ENV ? DEV_ADVERTISED_IDS : PROD_ADVERTISED_IDS;
// Accept both codex-5* and codev-5* everywhere to reduce friction; advertise per env
const ACCEPTED_MODEL_IDS = new Set([...DEV_ADVERTISED_IDS, ...PROD_ADVERTISED_IDS, DEFAULT_MODEL]);
const PROTECT_MODELS = (process.env.PROXY_PROTECT_MODELS || "false").toLowerCase() === "true";
// Opt-in guard: end the stream after tools to avoid confusing clients that expect
// tool-first, stop-after-tools behavior (e.g., Obsidian Copilot). Default off.
// When enabled, mode can be:
//  - "first": cut immediately after the first complete <use_tool> block
//  - "burst": cut after a short grace window to allow multiple back-to-back tool blocks
const STOP_AFTER_TOOLS = (process.env.PROXY_STOP_AFTER_TOOLS || "").toLowerCase() === "true";
const STOP_AFTER_TOOLS_MODE = (process.env.PROXY_STOP_AFTER_TOOLS_MODE || "burst").toLowerCase();
const STOP_AFTER_TOOLS_GRACE_MS = Number(process.env.PROXY_STOP_AFTER_TOOLS_GRACE_MS || 300);
const STOP_AFTER_TOOLS_MAX = Number(process.env.PROXY_TOOL_BLOCK_MAX || 0);
// Timeouts and connection stability
// Overall request timeout (non-stream especially). For long tasks, raise via PROXY_TIMEOUT_MS.
const REQ_TIMEOUT_MS = Number(process.env.PROXY_TIMEOUT_MS || 300000); // default 5m
// Default to not killing Codex on disconnect to better match typical OpenAI clients
const KILL_ON_DISCONNECT =
  (process.env.PROXY_KILL_ON_DISCONNECT || "false").toLowerCase() !== "false";
// Idle timeout when waiting for backend output.
const IDLE_TIMEOUT_MS = Number(process.env.PROXY_IDLE_TIMEOUT_MS || 15000);
// Separate idle timeout for streaming responses (allow much longer lulls between chunks)
const STREAM_IDLE_TIMEOUT_MS = Number(process.env.PROXY_STREAM_IDLE_TIMEOUT_MS || 300000); // default 5m
// Proto-specific idle for non-streaming aggregation before giving up (ms)
const PROTO_IDLE_MS = Number(process.env.PROXY_PROTO_IDLE_MS || 120000);
const DEBUG_PROTO = /^(1|true|yes)$/i.test(String(process.env.PROXY_DEBUG_PROTO || ""));
// Periodic SSE keepalive to prevent intermediaries closing idle connections (ms)
const SSE_KEEPALIVE_MS = Number(process.env.PROXY_SSE_KEEPALIVE_MS || 15000);

// DEV logging and parser utilities imported from a separate module

// helper definitions moved to src/utils.js

try {
  fs.mkdirSync(CODEX_WORKDIR, { recursive: true });
} catch (e) {
  try {
    console.error(`[proxy] failed to create CODEX_WORKDIR at ${CODEX_WORKDIR}:`, e);
  } catch {}
}

app.get("/healthz", (_req, res) => res.json({ ok: true, sandbox_mode: SANDBOX_MODE }));

// Usage query support (file-backed NDJSON aggregates)
const loadUsageEvents = () => {
  try {
    if (!fs.existsSync(TOKEN_LOG_PATH)) return [];
    const lines = fs.readFileSync(TOKEN_LOG_PATH, "utf8").split(/\n+/).filter(Boolean);
    return lines
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
};
// aggregateUsage available from utils
app.get("/v1/usage", (req, res) => {
  const start = parseTime(req.query.start) || 0;
  const end = parseTime(req.query.end) || Date.now() + 1;
  const group = (req.query.group || "").toString();
  const events = loadUsageEvents();
  const agg = aggregateUsage(events, start, end, group);
  res.json(agg);
});
app.get("/v1/usage/raw", (req, res) => {
  const limit = Math.max(1, Math.min(10000, Number(req.query.limit || 200)));
  const events = loadUsageEvents();
  res.json({ count: Math.min(limit, events.length), events: events.slice(-limit) });
});

// Helper: scan emitted text for completed <use_tool> blocks and log them
const scanAndLogToolBlocks = (emitted, state, reqId, route, mode) => {
  if (!LOG_PROTO) return;
  try {
    const { blocks, nextPos } = extractUseToolBlocks(emitted, state.pos);
    if (blocks && blocks.length) {
      for (const b of blocks) {
        appendProtoEvent({
          ts: Date.now(),
          req_id: reqId,
          route,
          mode,
          kind: "tool_block",
          idx: ++state.idx,
          char_start: b.start,
          char_end: b.end,
          tool: b.name,
          path: b.path,
          query: b.query,
        });
      }
      state.pos = nextPos;
    }
  } catch (e) {
    if (IS_DEV_ENV) {
      console.error("[dev][scanAndLogToolBlocks] error:", e);
    }
  }
};

// Normalize/alias model names. Accepts custom prefixes like "codex/<model>".
// normalizeModel / impliedEffortForModel available from utils

// Models router implementing GET/HEAD/OPTIONS with canonical headers
const modelsRouter = express.Router();
const modelsPayload = {
  object: "list",
  data: PUBLIC_MODEL_IDS.map((id) => ({ id, object: "model", owned_by: "codex", created: 0 })),
};
const sendModels = (res) => {
  applyCors(null, res);
  res.set("Content-Type", "application/json; charset=utf-8");
  res.set("Cache-Control", "public, max-age=60");
  res.status(200).send(JSON.stringify(modelsPayload));
};
modelsRouter.get("/v1/models", (req, res) => {
  try {
    console.log("[models] GET /v1/models");
  } catch {}
  if (PROTECT_MODELS) {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token || token !== API_KEY) {
      applyCors(null, res);
      return res
        .status(401)
        .set("WWW-Authenticate", "Bearer realm=api")
        .json({
          error: { message: "unauthorized", type: "authentication_error", code: "invalid_api_key" },
        });
    }
  }
  sendModels(res);
});
modelsRouter.get("/v1/models/", (req, res) => {
  try {
    console.log("[models] GET /v1/models/");
  } catch {}
  if (PROTECT_MODELS) {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token || token !== API_KEY) {
      applyCors(null, res);
      return res
        .status(401)
        .set("WWW-Authenticate", "Bearer realm=api")
        .json({
          error: { message: "unauthorized", type: "authentication_error", code: "invalid_api_key" },
        });
    }
  }
  sendModels(res);
});
modelsRouter.head("/v1/models", (req, res) => {
  applyCors(null, res);
  if (PROTECT_MODELS) {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token || token !== API_KEY) {
      return res.status(401).set("WWW-Authenticate", "Bearer realm=api").end();
    }
  }
  res.set("Content-Type", "application/json; charset=utf-8");
  res.status(200).end();
});
modelsRouter.head("/v1/models/", (req, res) => {
  applyCors(null, res);
  if (PROTECT_MODELS) {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token || token !== API_KEY) {
      return res.status(401).set("WWW-Authenticate", "Bearer realm=api").end();
    }
  }
  res.set("Content-Type", "application/json; charset=utf-8");
  res.status(200).end();
});
modelsRouter.options("/v1/models", (req, res) => {
  res.set("Allow", "GET,HEAD,OPTIONS");
  res.status(200).end();
});
modelsRouter.options("/v1/models/", (req, res) => {
  res.set("Allow", "GET,HEAD,OPTIONS");
  res.status(200).end();
});
app.use(modelsRouter);

// Alias for clients that call baseURL without trailing /v1 and then /models
// (Removed /models alias added for Cursor compatibility)

// OpenAI-compatible Chat Completions endpoint backed by Codex CLI
// Minimal preflight/HEAD support for compatibility with some IDEs/SDKs
app.options("/v1/chat/completions", (_req, res) => {
  res.set("Allow", "POST,HEAD,OPTIONS");
  res.status(200).end();
});
app.head("/v1/chat/completions", (_req, res) => {
  res.set("Content-Type", "application/json; charset=utf-8");
  res.status(200).end();
});

app.post("/v1/chat/completions", (req, res) => {
  const reqId = nanoid();
  const started = Date.now();
  let responded = false;
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token !== API_KEY) {
    applyCors(null, res);
    return res
      .status(401)
      .set("WWW-Authenticate", "Bearer realm=api")
      .json({
        error: { message: "unauthorized", type: "authentication_error", code: "invalid_api_key" },
      });
  }

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
  // Model allowlist with OpenAI-style not-found error
  if (body.model && !ACCEPTED_MODEL_IDS.has(requestedModel)) {
    applyCors(null, res);
    return res.status(404).json({
      error: {
        message: `The model ${requestedModel} does not exist or you do not have access to it.`,
        type: "invalid_request_error",
        param: "model",
        code: "model_not_found",
      },
    });
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

  const isStreamingReq = !!body.stream;
  const args = [
    "proto",
    "--config",
    'preferred_auth_method="chatgpt"',
    "--config",
    "project_doc_max_bytes=0",
    "--config",
    'history.persistence="none"',
    "--config",
    "tools.web_search=false",
    "--config",
    `sandbox_mode="${SANDBOX_MODE}"`,
    "--config",
    `model="${effectiveModel}"`,
  ];
  if (FORCE_PROVIDER) args.push("--config", `model_provider="${FORCE_PROVIDER}"`);
  // Attempt to set reasoning via config if supported
  if (allowEffort.has(reasoningEffort)) {
    // Prefer newer codex-cli config key; keep legacy key for backward compatibility
    args.push("--config", `model_reasoning_effort="${reasoningEffort}"`);
    args.push("--config", `reasoning.effort="${reasoningEffort}"`);
  }

  const prompt = joinMessages(messages);
  const promptTokensEst = estTokensForMessages(messages);

  // DEV LOGGING: capture full incoming prompts for debugging integrations
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
      RESOLVED_CODEX_BIN,
      args.join(" "),
      " prompt_len=",
      prompt.length
    );
  } catch {}
  const child = spawn(RESOLVED_CODEX_BIN, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, CODEX_HOME },
    cwd: CODEX_WORKDIR,
  });
  try {
    child.stdout.setEncoding && child.stdout.setEncoding("utf8");
  } catch {}
  try {
    child.stderr.setEncoding && child.stderr.setEncoding("utf8");
  } catch {}
  // onDone was unused; responded is managed inline in handlers
  const onChildError = (e) => {
    try {
      console.log("[proxy] child error:", e?.message || String(e));
    } catch {}
    if (responded) return;
    responded = true;
    if (isStreamingReq) {
      // If streaming has begun, send an error note and terminate stream
      try {
        // headers are set below before streaming branches
        res.write(
          `data: ${JSON.stringify({ error: { message: e?.message || "spawn error", type: "internal_server_error", code: "spawn_error" } })}\n\n`
        );
      } catch {}
      try {
        res.write("data: [DONE]\n\n");
        res.end();
      } catch {}
    } else {
      applyCors(null, res);
      res.status(500).json({
        error: {
          message: e?.message || "spawn error",
          type: "internal_server_error",
          code: "spawn_error",
        },
      });
      appendUsage({
        ts: Date.now(),
        req_id: reqId,
        route: "/v1/chat/completions",
        method: "POST",
        requested_model: requestedModel,
        effective_model: effectiveModel,
        stream: !!isStreamingReq,
        prompt_tokens_est: promptTokensEst,
        completion_tokens_est: 0,
        total_tokens_est: promptTokensEst,
        duration_ms: Date.now() - started,
        status: 500,
        user_agent: req.headers["user-agent"] || "",
      });
    }
  };
  child.on("error", onChildError);
  const timeout = setTimeout(() => {
    if (responded) return;
    onChildError(new Error("request timeout"));
    try {
      child.kill("SIGKILL");
    } catch {}
  }, REQ_TIMEOUT_MS);
  let idleTimer;
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (responded) return;
      try {
        console.log("[proxy] idle timeout reached; terminating child");
      } catch {}
      if (isStreamingReq) {
        try {
          res.write(
            `data: ${JSON.stringify({ error: { message: "backend idle timeout", type: "timeout_error", code: "idle_timeout" } })}\n\n`
          );
        } catch {}
        try {
          res.write("data: [DONE]\n\n");
          res.end();
        } catch {}
      } else {
        applyCors(null, res);
        res.status(504).json({
          error: { message: "backend idle timeout", type: "timeout_error", code: "idle_timeout" },
        });
      }
      responded = true;
      try {
        child.kill("SIGTERM");
      } catch {}
    }, IDLE_TIMEOUT_MS);
  };
  resetIdle();
  req.on("close", () => {
    if (responded) return;
    if (KILL_ON_DISCONNECT) {
      try {
        child.kill("SIGTERM");
      } catch {}
    }
  });

  // Defer writing submission until after listeners are attached

  let out = "",
    err = "";

  const sendSSE = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  const sendSSEKeepalive = () => {
    // SSE comment line; ignored by clients but keeps intermediaries from timing out
    res.write(`: keepalive ${Date.now()}\n\n`);
  };

  const sendRoleOnce = (() => {
    let sent = false;
    return () => {
      if (sent) return;
      sent = true;
      sendSSE({
        id: `chatcmpl-${nanoid()}`,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: requestedModel,
        choices: [{ index: 0, delta: { role: "assistant" } }],
      });
    };
  })();

  const finishSSE = () => {
    res.write("data: [DONE]\n\n");
    res.end();
  };

  if (isStreamingReq) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // prevent proxy buffering of SSE
    res.flushHeaders?.();
    if (idleTimer) {
      try {
        clearTimeout(idleTimer);
      } catch {}
    }
    let keepalive;
    if (SSE_KEEPALIVE_MS > 0)
      keepalive = setInterval(() => {
        try {
          sendSSEKeepalive();
        } catch {}
      }, SSE_KEEPALIVE_MS);
    sendRoleOnce();
    let buf = "";
    let sentAny = false;
    let emitted = "";
    let stoppedAfterTools = false; // if STOP_AFTER_TOOLS is on, we may cut stream early
    // Dev-only: track tool blocks as they appear in streamed content
    const toolState = { pos: 0, idx: 0 };
    let lastToolIdx = 0;
    let cutTimer = null;
    const includeUsage = !!(body?.stream_options?.include_usage || body?.include_usage);
    let ptCount = 0,
      ctCount = 0;
    const resetStreamIdle = (() => {
      let t;
      return () => {
        if (t) clearTimeout(t);
        t = setTimeout(() => {
          try {
            child.kill("SIGTERM");
          } catch {}
        }, STREAM_IDLE_TIMEOUT_MS);
      };
    })();
    resetStreamIdle();
    child.stdout.on("data", (chunk) => {
      resetStreamIdle();
      const s = chunk.toString("utf8");
      out += s;
      buf += s;
      if (LOG_PROTO) {
        // Raw line capture for correlation if JSON parsing ever fails upstream
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
          if (t === "session_configured" || t === "task_started" || t === "agent_reasoning_delta") {
            continue;
          }
          if (t === "agent_message_delta") {
            const d = String((evt.msg?.delta ?? evt.delta) || "");
            if (d) {
              let suffix = d;
              if (d.startsWith(emitted)) suffix = d.slice(emitted.length);
              // If provider sends tiny incremental pieces, suffix may equal d and not start with emitted; append anyway
              if (suffix) {
                sentAny = true;
                emitted += suffix;
                sendSSE({
                  id: `chatcmpl-${nanoid()}`,
                  object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model: requestedModel,
                  choices: [{ index: 0, delta: { content: suffix } }],
                });
                scanAndLogToolBlocks(
                  emitted,
                  toolState,
                  reqId,
                  "/v1/chat/completions",
                  "chat_stream"
                );
                // Optional early-cut behavior to avoid post-tool narration confusing clients.
                if (STOP_AFTER_TOOLS && !stoppedAfterTools) {
                  const blocksSeen = Number(toolState.idx || 0);
                  const newBlocks = blocksSeen - lastToolIdx;
                  if (newBlocks > 0) {
                    lastToolIdx = blocksSeen;
                    const cutNow = () => {
                      if (stoppedAfterTools) return;
                      stoppedAfterTools = true;
                      try {
                        if (LOG_PROTO) {
                          appendProtoEvent({
                            ts: Date.now(),
                            req_id: reqId,
                            route: "/v1/chat/completions",
                            mode: "chat_stream",
                            kind: "stream_cut_after_tool",
                            tool_blocks_seen: blocksSeen,
                            cut_mode: STOP_AFTER_TOOLS_MODE,
                            grace_ms: STOP_AFTER_TOOLS_GRACE_MS,
                          });
                        }
                      } catch {}
                      try {
                        if (keepalive) clearInterval(keepalive);
                      } catch {}
                      try {
                        finishSSE();
                      } catch {}
                      try {
                        child.kill("SIGTERM");
                      } catch {}
                    };
                    // Respect max blocks guard (0 = unlimited)
                    if (STOP_AFTER_TOOLS_MAX > 0 && blocksSeen >= STOP_AFTER_TOOLS_MAX) {
                      cutNow();
                      return;
                    }
                    if (STOP_AFTER_TOOLS_MODE === "first") {
                      cutNow();
                      return;
                    }
                    // burst mode (default): wait for a short grace period and reset if more blocks arrive
                    try { if (cutTimer) clearTimeout(cutTimer); } catch {}
                    cutTimer = setTimeout(cutNow, Math.max(0, STOP_AFTER_TOOLS_GRACE_MS));
                  }
                }
              }
            }
          } else if (t === "agent_message") {
            const m = String((evt.msg?.message ?? evt.message) || "");
            if (m) {
              let suffix = "";
              if (m.startsWith(emitted)) suffix = m.slice(emitted.length);
              else if (!sentAny) suffix = m; // emit full message only if we have not sent any deltas
              if (suffix) {
                sentAny = true;
                emitted += suffix;
                sendSSE({
                  id: `chatcmpl-${nanoid()}`,
                  object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model: requestedModel,
                  choices: [{ index: 0, delta: { content: suffix } }],
                });
                scanAndLogToolBlocks(
                  emitted,
                  toolState,
                  reqId,
                  "/v1/chat/completions",
                  "chat_stream"
                );
              }
            }
          } else if (t === "token_count") {
            ptCount = Number(evt.msg?.prompt_tokens || 0);
            ctCount = Number(evt.msg?.completion_tokens || 0);
            if (includeUsage) {
              sendSSE({
                event: "usage",
                usage: {
                  prompt_tokens: ptCount,
                  completion_tokens: ctCount,
                  total_tokens: ptCount + ctCount,
                },
              });
            }
          } else if (t === "task_complete") {
            // Finish stream immediately on task completion
            // DEV LOGGING: dump the final emitted assistant text to console in dev
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
              if (IS_DEV_ENV) {
                console.error("[dev][response][chat][stream] usage error:", e);
              }
            }
            try {
              finishSSE();
            } catch {}
            try {
              child.kill("SIGTERM");
            } catch {}
            return;
          } else if (t === "error") {
            if (process.env.PROXY_DEBUG_PROTO)
              try {
                console.log("[proto] error event");
              } catch {}
          }
        } catch (e) {
          if (process.env.PROXY_DEBUG_PROTO)
            try {
              console.log("[proto] parse error line:", trimmed);
            } catch {}
        }
      }
    });
    child.stderr.on("data", (e) => {
      resetStreamIdle();
      if (LOG_PROTO)
        appendProtoEvent({
          ts: Date.now(),
          req_id: reqId,
          route: "/v1/chat/completions",
          mode: "chat_stream",
          kind: "stderr",
          chunk: e.toString("utf8"),
        });
    });
    // Write submission after listeners are attached
    try {
      const submission = {
        id: reqId,
        op: { type: "user_input", items: [{ type: "text", text: prompt }] },
      };
      child.stdin.write(JSON.stringify(submission) + "\n");
    } catch {}
    child.on("close", () => {
      // If we already cut the stream after tools, avoid double-ending SSE here
      if (stoppedAfterTools) {
        try { if (cutTimer) clearTimeout(cutTimer); } catch {}
        return;
      }
      if (keepalive) clearInterval(keepalive);
      if (!sentAny) {
        const content = stripAnsi(out).trim() || "No output from backend.";
        sendSSE({
          id: `chatcmpl-${nanoid()}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: requestedModel,
          choices: [{ index: 0, delta: { content } }],
        });
        if (IS_DEV_ENV) {
          try {
            console.log("[dev][response][chat][stream] content=\n" + content);
          } catch (e) {
            console.error("[dev][response][chat][stream] error:", e);
          }
        }
      }
      finishSSE(); // always end with [DONE]
    });
    return;
  }

  // Non-streaming (proto): assemble content until task completion
  if (idleTimer) {
    try {
      clearTimeout(idleTimer);
    } catch {}
  }
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (idleTimer) {
    try {
      clearTimeout(idleTimer);
    } catch {}
  }
  let buf2 = "";
  let content = "";
  let prompt_tokens = 0;
  let completion_tokens = 0;
  let done = false;
  const resetProtoIdle = (() => {
    let t;
    return () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        if (responded) return;
        responded = true;
        try {
          child.kill("SIGTERM");
        } catch {}
        applyCors(null, res);
        res.status(504).json({
          error: { message: "backend idle timeout", type: "timeout_error", code: "idle_timeout" },
        });
      }, PROTO_IDLE_MS);
    };
  })();
  resetProtoIdle();
  child.stdout.on("data", (d) => {
    resetProtoIdle();
    const s = typeof d === "string" ? d : d.toString("utf8");
    out += s;
    buf2 += s;
    if (LOG_PROTO)
      appendProtoEvent({
        ts: Date.now(),
        req_id: reqId,
        route: "/v1/chat/completions",
        mode: "chat_nonstream",
        kind: "stdout",
        chunk: s,
      });
    let idx;
    while ((idx = buf2.indexOf("\n")) >= 0) {
      const line = buf2.slice(0, idx);
      buf2 = buf2.slice(idx + 1);
      const t = line.trim();
      if (!t) continue;
      try {
        const evt = JSON.parse(t);
        const tp = (evt && (evt.msg?.type || evt.type)) || "";
        appendProtoEvent({
          ts: Date.now(),
          req_id: reqId,
          route: "/v1/chat/completions",
          mode: "chat_nonstream",
          kind: "event",
          event: evt,
        });
        if (DEBUG_PROTO)
          try {
            console.log("[proto] evt:", tp);
          } catch {}
        if (tp === "agent_message_delta") content += String((evt.msg?.delta ?? evt.delta) || "");
        else if (tp === "agent_message")
          content = String((evt.msg?.message ?? evt.message) || content);
        else if (tp === "token_count") {
          prompt_tokens = Number(evt.msg?.prompt_tokens || prompt_tokens);
          completion_tokens = Number(evt.msg?.completion_tokens || completion_tokens);
        } else if (tp === "task_complete") {
          done = true;
          if (!responded) {
            responded = true;
            applyCors(null, res);
            const final =
              content ||
              stripAnsi(out).trim() ||
              stripAnsi(err).trim() ||
              "No output from backend.";
            // Dev-only: extract and log tool blocks from final content
            if (LOG_PROTO) {
              try {
                const { blocks } = extractUseToolBlocks(final, 0);
                let idxTool = 0;
                for (const b of blocks || []) {
                  appendProtoEvent({
                    ts: Date.now(),
                    req_id: reqId,
                    route: "/v1/chat/completions",
                    mode: "chat_nonstream",
                    kind: "tool_block",
                    idx: ++idxTool,
                    char_start: b.start,
                    char_end: b.end,
                    tool: b.name,
                    path: b.path,
                    query: b.query,
                  });
                }
              } catch {}
            }
            res.json({
              id: `chatcmpl-${nanoid()}`,
              object: "chat.completion",
              created: Math.floor(Date.now() / 1000),
              model: requestedModel,
              choices: [
                { index: 0, message: { role: "assistant", content: final }, finish_reason: "stop" },
              ],
            });
            try {
              child.stdin.write(JSON.stringify({ id: nanoid(), op: { type: "shutdown" } }) + "\n");
            } catch {}
            try {
              child.kill("SIGTERM");
            } catch {}
          }
        }
      } catch {}
    }
  });
  child.stderr.on("data", () => {
    resetProtoIdle();
  });
  // Write submission after listeners are attached
  try {
    const submission = {
      id: reqId,
      op: { type: "user_input", items: [{ type: "text", text: prompt }] },
    };
    child.stdin.write(JSON.stringify(submission) + "\n");
  } catch {}
  child.on("close", () => {
    if (responded) return;
    responded = true;
    clearTimeout(timeout);
    if (idleTimer) clearTimeout(idleTimer);
    const final =
      content || stripAnsi(out).trim() || stripAnsi(err).trim() || "No output from backend.";
    applyCors(null, res);
    const pt = prompt_tokens || promptTokensEst;
    const ct = completion_tokens || estTokens(final);
    try {
      appendUsage({
        ts: Date.now(),
        req_id: reqId,
        route: "/v1/chat/completions",
        method: "POST",
        requested_model: requestedModel,
        effective_model: effectiveModel,
        stream: false,
        prompt_tokens_est: pt,
        completion_tokens_est: ct,
        total_tokens_est: pt + ct,
        duration_ms: Date.now() - started,
        status: 200,
        user_agent: req.headers["user-agent"] || "",
      });
    } catch {}
    if (IS_DEV_ENV) {
      try {
        console.log("[dev][response][chat][nonstream] content=\n" + final);
      } catch (e) {
        console.error("[dev][response][chat][nonstream] error:", e);
      }
    }
    res.json({
      id: `chatcmpl-${nanoid()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: requestedModel,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: final },
          finish_reason: done ? "stop" : "length",
        },
      ],
      usage: { prompt_tokens: pt, completion_tokens: ct, total_tokens: pt + ct },
    });
  });
});

// OpenAI-compatible Completions shim mapped to Chat backend
app.options("/v1/completions", (_req, res) => {
  res.set("Allow", "POST,HEAD,OPTIONS");
  res.status(200).end();
});
app.head("/v1/completions", (_req, res) => {
  res.set("Content-Type", "application/json; charset=utf-8");
  res.status(200).end();
});
app.post("/v1/completions", (req, res) => {
  try {
    console.log("[completions] POST /v1/completions received");
  } catch {}
  const reqId = nanoid();
  const started = Date.now();
  let responded = false;
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token !== API_KEY) {
    applyCors(null, res);
    return res
      .status(401)
      .set("WWW-Authenticate", "Bearer realm=api")
      .json({
        error: { message: "unauthorized", type: "authentication_error", code: "invalid_api_key" },
      });
  }

  const body = req.body || {};
  try {
    console.log("[completions] body keys=", Object.keys(body || {}));
  } catch {}
  const prompt = Array.isArray(body.prompt) ? body.prompt.join("\n") : body.prompt || "";
  // DEV LOGGING: body-level prompt capture for legacy completions shim
  if (IS_DEV_ENV) {
    try {
      console.log("[dev][prompt][completions] prompt=\n" + prompt);
      appendProtoEvent({
        ts: Date.now(),
        req_id: reqId,
        route: "/v1/chat/completions",
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
    return res.status(404).json({
      error: {
        message: `The model ${requestedModel} does not exist or you do not have access to it.`,
        type: "invalid_request_error",
        param: "model",
        code: "model_not_found",
      },
    });
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

  const isStreamingReq = !!body.stream;
  const args = [
    "proto",
    "--config",
    'preferred_auth_method="chatgpt"',
    "--config",
    "project_doc_max_bytes=0",
    "--config",
    'history.persistence="none"',
    "--config",
    "tools.web_search=false",
    "--config",
    `sandbox_mode="${SANDBOX_MODE}"`,
    "--config",
    `model="${effectiveModel}"`,
  ];
  if (FORCE_PROVIDER) args.push("--config", `model_provider="${FORCE_PROVIDER}"`);
  if (allowEffort.has(reasoningEffort)) {
    args.push("--config", `model_reasoning_effort="${reasoningEffort}"`);
    args.push("--config", `reasoning.effort="${reasoningEffort}"`);
  }

  const messages = [{ role: "user", content: prompt }];
  const toSend = joinMessages(messages);
  const promptTokensEst = estTokensForMessages(messages);

  try {
    console.log(
      "[proxy] spawning (proto completions):",
      RESOLVED_CODEX_BIN,
      args.join(" "),
      " prompt_len=",
      toSend.length
    );
  } catch {}
  const child = spawn(RESOLVED_CODEX_BIN, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, CODEX_HOME },
    cwd: CODEX_WORKDIR,
  });
  const onChildError = (e) => {
    try {
      console.log("[proxy] child error (completions):", e?.message || String(e));
    } catch {}
    if (responded) return;
    responded = true;
    if (isStreamingReq) {
      try {
        res.write(
          `data: ${JSON.stringify({ error: { message: e?.message || "spawn error", type: "internal_server_error", code: "spawn_error" } })}\n\n`
        );
      } catch {}
      try {
        res.write("data: [DONE]\n\n");
        res.end();
      } catch {}
    } else {
      applyCors(null, res);
      res.status(500).json({
        error: {
          message: e?.message || "spawn error",
          type: "internal_server_error",
          code: "spawn_error",
        },
      });
    }
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
      if (isStreamingReq) {
        try {
          res.write(
            `data: ${JSON.stringify({ error: { message: "backend idle timeout", type: "timeout_error", code: "idle_timeout" } })}\n\n`
          );
        } catch {}
        try {
          res.write("data: [DONE]\n\n");
          res.end();
        } catch {}
      } else {
        applyCors(null, res);
        res.status(504).json({
          error: { message: "backend idle timeout", type: "timeout_error", code: "idle_timeout" },
        });
      }
      responded = true;
      try {
        child.kill("SIGTERM");
      } catch {}
    }, IDLE_TIMEOUT_MS);
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

  let out = "",
    err = "";
  const sendSSE = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  const finishSSE = () => {
    res.write("data: [DONE]\n\n");
    res.end();
  };

  if (isStreamingReq) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // prevent proxy buffering of SSE
    res.flushHeaders?.();
    let buf = "";
    let sentAny = false;
    let completionChars = 0;
    let emitted = "";
    // Dev-only: track tool blocks in completions streaming content
    const toolStateC = { pos: 0, idx: 0 };
    child.stdout.on("data", (chunk) => {
      resetIdleCompletions();
      const text = chunk.toString("utf8");
      out += text;
      buf += text;
      if (LOG_PROTO)
        appendProtoEvent({
          ts: Date.now(),
          req_id: reqId,
          route: "/v1/chat/completions",
          mode: "completions_stream",
          kind: "stdout",
          chunk: text,
        });
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
            mode: "completions_stream",
            kind: "event",
            event: evt,
          });
          if (t === "agent_message_delta") {
            const delta = String((evt.msg?.delta ?? evt.delta) || "");
            if (delta) {
              let suffix = delta;
              if (delta.startsWith(emitted)) suffix = delta.slice(emitted.length);
              if (suffix) {
                sentAny = true;
                emitted += suffix;
                completionChars += suffix.length;
                sendSSE({
                  id: `cmpl-${nanoid()}`,
                  object: "text_completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model: requestedModel,
                  choices: [{ index: 0, text: suffix }],
                });
                scanAndLogToolBlocks(
                  emitted,
                  toolStateC,
                  reqId,
                  "/v1/chat/completions",
                  "completions_stream"
                );
              }
            }
          } else if (t === "agent_message") {
            const message = String((evt.msg?.message ?? evt.message) || "");
            if (message) {
              let suffix = "";
              if (message.startsWith(emitted)) suffix = message.slice(emitted.length);
              else if (!sentAny) suffix = message;
              if (suffix) {
                sentAny = true;
                emitted += suffix;
                completionChars += suffix.length;
                sendSSE({
                  id: `cmpl-${nanoid()}`,
                  object: "text_completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model: requestedModel,
                  choices: [{ index: 0, text: suffix }],
                });
                scanAndLogToolBlocks(
                  emitted,
                  toolStateC,
                  reqId,
                  "/v1/chat/completions",
                  "completions_stream"
                );
              }
            }
          }
        } catch {}
      }
    });
    child.stderr.on("data", (e) => {
      resetIdleCompletions();
      const s = e.toString("utf8");
      err += s;
      try {
        console.log("[proxy] child stderr:", s.trim());
      } catch {}
      if (LOG_PROTO)
        appendProtoEvent({
          ts: Date.now(),
          req_id: reqId,
          route: "/v1/chat/completions",
          mode: "completions_stream",
          kind: "stderr",
          chunk: s,
        });
    });
    child.on("close", (_code) => {
      clearTimeout(timeout);
      if (idleTimerCompletions) clearTimeout(idleTimerCompletions);
      if (!sentAny) {
        const content = stripAnsi(out).trim() || "No output from backend.";
        sendSSE({
          id: `cmpl-${nanoid()}`,
          object: "text_completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: requestedModel,
          choices: [{ index: 0, text: content }],
        });
        if (IS_DEV_ENV) {
          try {
            console.log("[dev][response][completions][stream] content=\n" + content);
          } catch (e) {
            console.error("[dev][response][completions][stream] error:", e);
          }
        }
      }
      if (IS_DEV_ENV && sentAny) {
        try {
          console.log("[dev][response][completions][stream] content=\n" + emitted);
        } catch (e) {
          console.error("[dev][response][completions][stream] error:", e);
        }
      }
      const completion_tokens_est = Math.ceil(completionChars / 4);
      // Dev-only: emit any remaining tool blocks parsed from full emitted text
      if (LOG_PROTO) {
        try {
          const { blocks } = extractUseToolBlocks(emitted, toolStateC.pos);
          for (const b of blocks || []) {
            appendProtoEvent({
              ts: Date.now(),
              req_id: reqId,
              route: "/v1/chat/completions",
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
        } catch (e) {
          if (IS_DEV_ENV) {
            console.error("[dev][response][completions][stream] tool block error:", e);
          }
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
        prompt_tokens_est: promptTokensEst,
        completion_tokens_est,
        total_tokens_est: promptTokensEst + completion_tokens_est,
        duration_ms: Date.now() - started,
        status: 200,
        user_agent: req.headers["user-agent"] || "",
      });
      finishSSE();
    });
    return;
  }

  // Non-streaming (proto): accumulate text
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  let bufN = "";
  let content = "";
  let prompt_tokens = 0;
  let completion_tokens = 0;
  child.stdout.on("data", (d) => {
    resetIdleCompletions();
    const s = d.toString("utf8");
    out += s;
    bufN += s;
    if (LOG_PROTO)
      appendProtoEvent({
        ts: Date.now(),
        req_id: reqId,
        route: "/v1/chat/completions",
        mode: "completions_nonstream",
        kind: "stdout",
        chunk: s,
      });
    let idx;
    while ((idx = bufN.indexOf("\n")) >= 0) {
      const line = bufN.slice(0, idx);
      bufN = bufN.slice(idx + 1);
      const t = line.trim();
      if (!t) continue;
      try {
        const evt = JSON.parse(t);
        const tp = (evt && (evt.msg?.type || evt.type)) || "";
        appendProtoEvent({
          ts: Date.now(),
          req_id: reqId,
          route: "/v1/chat/completions",
          mode: "completions_nonstream",
          kind: "event",
          event: evt,
        });
        if (tp === "agent_message_delta") content += String((evt.msg?.delta ?? evt.delta) || "");
        else if (tp === "agent_message")
          content = String((evt.msg?.message ?? evt.message) || content);
        else if (tp === "token_count") {
          prompt_tokens = Number(evt.msg?.prompt_tokens || prompt_tokens);
          completion_tokens = Number(evt.msg?.completion_tokens || completion_tokens);
        }
      } catch {}
    }
  });
  child.stderr.on("data", (d) => {
    resetIdleCompletions();
    err += d.toString("utf8");
    if (LOG_PROTO)
      appendProtoEvent({
        ts: Date.now(),
        req_id: reqId,
        route: "/v1/chat/completions",
        mode: "completions_nonstream",
        kind: "stderr",
        chunk: d.toString("utf8"),
      });
  });
  child.on("close", () => {
    if (responded) return;
    responded = true;
    clearTimeout(timeout);
    if (idleTimerCompletions) clearTimeout(idleTimerCompletions);
    const textOut =
      content || stripAnsi(out).trim() || stripAnsi(err).trim() || "No output from backend.";
    applyCors(null, res);
    const pt = prompt_tokens || promptTokensEst;
    const ct = completion_tokens || estTokens(textOut);
    // Dev-only: extract and log tool blocks from non-stream completions text
    if (LOG_PROTO) {
      try {
        const { blocks } = extractUseToolBlocks(textOut, 0);
        let idxTool = 0;
        for (const b of blocks || []) {
          appendProtoEvent({
            ts: Date.now(),
            req_id: reqId,
            route: "/v1/chat/completions",
            mode: "completions_nonstream",
            kind: "tool_block",
            idx: ++idxTool,
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
      route: "/v1/chat/completions",
      method: "POST",
      requested_model: requestedModel,
      effective_model: effectiveModel,
      stream: false,
      prompt_tokens_est: pt,
      completion_tokens_est: ct,
      total_tokens_est: pt + ct,
      duration_ms: Date.now() - started,
      status: 200,
      user_agent: req.headers["user-agent"] || "",
    });
    res.json({
      id: `cmpl-${nanoid()}`,
      object: "text_completion",
      created: Math.floor(Date.now() / 1000),
      model: requestedModel,
      choices: [{ index: 0, text: textOut, logprobs: null, finish_reason: "stop" }],
      usage: { prompt_tokens: pt, completion_tokens: ct, total_tokens: pt + ct },
    });
  });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`codex-openai-proxy listening on http://127.0.0.1:${PORT}/v1`);
});
