import express from "express";
import { spawn } from "node:child_process";
import { nanoid } from "nanoid";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// Simple CORS without extra dependency
const CORS_ENABLED = (process.env.PROXY_ENABLE_CORS || "true").toLowerCase() !== "false";
const applyCors = (req, res) => {
  if (!CORS_ENABLED) return;
  const origin = req?.headers?.origin;
  if (origin) {
    // Reflect the Origin to support non-HTTP schemes like app://obsidian.md
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    // Allow credentials in case clients use them; safe with reflected origin
    res.setHeader("Access-Control-Allow-Credentials", "true");
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept");
  res.setHeader("Access-Control-Max-Age", "600");
};

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
      console.log(`[http] ${req.method} ${req.originalUrl} -> ${res.statusCode} auth=${auth} ua="${ua}" dur_ms=${dur}`);
    } catch {}
  });
  next();
});

const PORT = Number(process.env.PORT || 11435);
const API_KEY = process.env.PROXY_API_KEY || "codex-local-secret";
const DEFAULT_MODEL = process.env.CODEX_MODEL || "gpt-5";
const CODEX_BIN = process.env.CODEX_BIN || "codex";
// Allow isolating Codex CLI configuration per deployment. When set, child processes
// receive CODEX_HOME so Codex reads config from `${CODEX_HOME}/config.toml`.
// Default to a dedicated directory `~/.codex-api` so interactive CLI (`~/.codex`) remains separate.
const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir?.() || process.env.HOME || "", ".codex-api");
const STREAM_MODE = (process.env.PROXY_STREAM_MODE || "incremental").toLowerCase();
const FORCE_PROVIDER = (process.env.CODEX_FORCE_PROVIDER || "").trim();
const REASONING_VARIANTS = ["low", "medium", "high", "minimal"];
const PUBLIC_MODEL_IDS = ["codex-5", ...REASONING_VARIANTS.map(v => `codex-5-${v}`)];
const ALLOWED_MODEL_IDS = new Set([...PUBLIC_MODEL_IDS, DEFAULT_MODEL]);
const PROTECT_MODELS = (process.env.PROXY_PROTECT_MODELS || "false").toLowerCase() === "true";
// Timeouts and connection stability
// Overall request timeout (non-stream especially). For long tasks, raise via PROXY_TIMEOUT_MS.
const REQ_TIMEOUT_MS = Number(process.env.PROXY_TIMEOUT_MS || 300000); // default 5m
// Default to not killing Codex on disconnect to better match typical OpenAI clients
const KILL_ON_DISCONNECT = (process.env.PROXY_KILL_ON_DISCONNECT || "false").toLowerCase() !== "false";
// Idle timeout when waiting for backend output.
const IDLE_TIMEOUT_MS = Number(process.env.PROXY_IDLE_TIMEOUT_MS || 15000);
// Separate idle timeout for streaming responses (allow much longer lulls between chunks)
const STREAM_IDLE_TIMEOUT_MS = Number(process.env.PROXY_STREAM_IDLE_TIMEOUT_MS || 300000); // default 5m
// Proto-specific idle for non-streaming aggregation before giving up (ms)
const PROTO_IDLE_MS = Number(process.env.PROXY_PROTO_IDLE_MS || 120000);
const DEBUG_PROTO = /^(1|true|yes)$/i.test(String(process.env.PROXY_DEBUG_PROTO || ""));
// Periodic SSE keepalive to prevent intermediaries closing idle connections (ms)
const SSE_KEEPALIVE_MS = Number(process.env.PROXY_SSE_KEEPALIVE_MS || 15000);

// Approximate token usage logging
const TOKEN_LOG_PATH = process.env.TOKEN_LOG_PATH || path.join(process.cwd(), "logs", "usage.ndjson");
try { fs.mkdirSync(path.dirname(TOKEN_LOG_PATH), { recursive: true }); } catch {}
const estTokens = (s = "") => Math.ceil(String(s).length / 4);
const estTokensForMessages = (msgs = []) => {
  let chars = 0;
  for (const m of msgs) {
    if (!m) continue;
    const c = m.content;
    if (Array.isArray(c)) chars += c.map(x => (typeof x === "string" ? x : JSON.stringify(x))).join("").length;
    else chars += String(c || "").length;
  }
  return Math.ceil(chars / 4);
};
const appendUsage = (obj = {}) => {
  try { fs.appendFileSync(TOKEN_LOG_PATH, JSON.stringify(obj) + "\n", { encoding: "utf8" }); } catch {}
};

const stripAnsi = (s = "") => s.replace(/\x1B\[[0-?]*[ -/]*[@-~]|\r|\u0008/g, "");
const toStringContent = (c) => {
  if (typeof c === "string") return c;
  try { return JSON.stringify(c); } catch { return String(c); }
};
const joinMessages = (messages = []) =>
  messages.map(m => `[${m.role || "user"}] ${toStringContent(m.content)}`).join("\n");

const isModelText = (line) => {
  const l = line.trim();
  if (!l) return false;
  if (/^(diff --git|\+\+\+ |--- |@@ )/.test(l)) return false; // diff headers
  if (/^\*\*\* (Begin|End) Patch/.test(l)) return false; // apply_patch envelopes
  if (/^(running:|command:|applying patch|reverted|workspace|approval|sandbox|tool:|mcp:|file:|path:)/i.test(l)) return false; // runner logs
  if (/^\[\d{4}-\d{2}-\d{2}T/.test(l)) return false; // timestamped log lines
  if (/^[-]{6,}$/.test(l)) return false; // separators
  if (/^(workdir|model|provider|approval|sandbox|reasoning effort|reasoning summaries|tokens used):/i.test(l)) return false;
  if (/^user instructions:/i.test(l)) return false;
  if (/^codex$/i.test(l)) return false;
  return true;
};

app.get("/healthz", (_req, res) => res.json({ ok: true }));

// Usage query support (file-backed NDJSON aggregates)
const parseTime = (v) => {
  if (!v) return 0;
  if (/^\d+$/.test(String(v))) return Number(v);
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : t;
};
const loadUsageEvents = () => {
  try {
    if (!fs.existsSync(TOKEN_LOG_PATH)) return [];
    const lines = fs.readFileSync(TOKEN_LOG_PATH, "utf8").split(/\n+/).filter(Boolean);
    return lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
};
const aggregateUsage = (events = [], start = 0, end = Date.now() + 1, group = "") => {
  const filtered = events.filter(e => (e.ts || 0) >= start && (e.ts || 0) < end);
  const agg = { total_requests: 0, prompt_tokens_est: 0, completion_tokens_est: 0, total_tokens_est: 0 };
  const buckets = {};
  for (const e of filtered) {
    agg.total_requests += 1;
    agg.prompt_tokens_est += e.prompt_tokens_est || 0;
    agg.completion_tokens_est += e.completion_tokens_est || 0;
    agg.total_tokens_est += e.total_tokens_est || 0;
    if (group === "hour" || group === "day") {
      const d = new Date(e.ts || 0);
      const key = group === "hour" ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).toISOString() : new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
      buckets[key] ||= { ts: key, requests: 0, prompt_tokens_est: 0, completion_tokens_est: 0, total_tokens_est: 0 };
      const b = buckets[key];
      b.requests += 1; b.prompt_tokens_est += e.prompt_tokens_est || 0; b.completion_tokens_est += e.completion_tokens_est || 0; b.total_tokens_est += e.total_tokens_est || 0;
    }
  }
  const out = { start, end, group: group || undefined, ...agg };
  if (group === "hour" || group === "day") out.buckets = Object.values(buckets).sort((a,b)=>a.ts.localeCompare(b.ts));
  return out;
};
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

// Normalize/alias model names. Accepts custom prefixes like "codex/<model>".
const normalizeModel = (name) => {
  const raw = String(name || "").trim();
  if (!raw) return { requested: "codex-5", effective: DEFAULT_MODEL };
  // Primary advertised alias without slashes
  const lower = raw.toLowerCase();
  if (lower === "codex-5") return { requested: "codex-5", effective: DEFAULT_MODEL };
  // Reasoning variants map to the effective default model
  if (PUBLIC_MODEL_IDS.includes(lower)) return { requested: lower, effective: DEFAULT_MODEL };
  // Allow direct use of underlying model
  return { requested: raw, effective: raw };
};

const impliedEffortForModel = (requestedModel) => {
  const m = String(requestedModel || "").toLowerCase();
  for (const v of REASONING_VARIANTS) {
    if (m === `codex-5-${v}`) return v;
  }
  return "";
};

// Models router implementing GET/HEAD/OPTIONS with canonical headers
const modelsRouter = express.Router();
const modelsPayload = { object: "list", data: PUBLIC_MODEL_IDS.map(id => ({ id, object: "model", owned_by: "codex", created: 0 })) };
const sendModels = (res) => {
  applyCors(null, res);
  res.set("Content-Type", "application/json; charset=utf-8");
  res.set("Cache-Control", "public, max-age=60");
  res.status(200).send(JSON.stringify(modelsPayload));
};
modelsRouter.get("/v1/models", (req, res) => {
  try { console.log("[models] GET /v1/models"); } catch {}
  if (PROTECT_MODELS) {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token || token !== API_KEY) {
      applyCors(null, res);
      return res
        .status(401)
        .set("WWW-Authenticate", "Bearer realm=api")
        .json({ error: { message: "unauthorized", type: "authentication_error", code: "invalid_api_key" } });
    }
  }
  sendModels(res);
});
modelsRouter.get("/v1/models/", (req, res) => {
  try { console.log("[models] GET /v1/models/"); } catch {}
  if (PROTECT_MODELS) {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token || token !== API_KEY) {
      applyCors(null, res);
      return res
        .status(401)
        .set("WWW-Authenticate", "Bearer realm=api")
        .json({ error: { message: "unauthorized", type: "authentication_error", code: "invalid_api_key" } });
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
      return res
        .status(401)
        .set("WWW-Authenticate", "Bearer realm=api")
        .end();
    }
  }
  res.set("Content-Type", "application/json; charset=utf-8"); res.status(200).end();
});
modelsRouter.head("/v1/models/", (req, res) => {
  applyCors(null, res);
  if (PROTECT_MODELS) {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token || token !== API_KEY) {
      return res
        .status(401)
        .set("WWW-Authenticate", "Bearer realm=api")
        .end();
    }
  }
  res.set("Content-Type", "application/json; charset=utf-8"); res.status(200).end();
});
modelsRouter.options("/v1/models", (req, res) => { res.set("Allow", "GET,HEAD,OPTIONS"); res.status(200).end(); });
modelsRouter.options("/v1/models/", (req, res) => { res.set("Allow", "GET,HEAD,OPTIONS"); res.status(200).end(); });
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
      .json({ error: { message: "unauthorized", type: "authentication_error", code: "invalid_api_key" } });
  }

  const body = req.body || {};
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) {
    applyCors(null, res);
    return res.status(400).json({ error: { message: "messages[] required", type: "invalid_request_error", param: "messages", code: "invalid_request_error" } });
  }

  const { requested: requestedModel, effective: effectiveModel } = normalizeModel(body.model || DEFAULT_MODEL);
  try { console.log(`[proxy] model requested=${requestedModel} effective=${effectiveModel} stream=${!!body.stream}`); } catch {}
  // Model allowlist with OpenAI-style not-found error
  if (body.model && !ALLOWED_MODEL_IDS.has(requestedModel)) {
    applyCors(null, res);
    return res.status(404).json({
      error: {
        message: `The model ${requestedModel} does not exist or you do not have access to it.`,
        type: "invalid_request_error",
        param: "model",
        code: "model_not_found"
      }
    });
  }
  let reasoningEffort = (
    (body.reasoning?.effort || body.reasoning_effort || body.reasoningEffort || "")
      .toString()
      .toLowerCase()
  );
  const allowEffort = new Set(["low", "medium", "high", "minimal"]);
  if (!reasoningEffort) {
    const implied = impliedEffortForModel(requestedModel);
    if (implied) reasoningEffort = implied;
  }

  const isStreamingReq = !!body.stream;
  const args = [
    "proto",
    "--config", 'preferred_auth_method="chatgpt"',
    "--config", "project_doc_max_bytes=0",
    "--config", 'history.persistence="none"',
    "--config", 'tools.web_search=false',
    "--config", `model="${effectiveModel}"`
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

  try { console.log("[proxy] spawning (proto):", CODEX_BIN, args.join(" "), " prompt_len=", prompt.length); } catch {}
  const child = spawn(CODEX_BIN, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, CODEX_HOME },
  });
  try { child.stdout.setEncoding && child.stdout.setEncoding("utf8"); } catch {}
  try { child.stderr.setEncoding && child.stderr.setEncoding("utf8"); } catch {}
  const onDone = () => { responded = true; };
  const onChildError = (e) => {
    try { console.log("[proxy] child error:", e?.message || String(e)); } catch {}
    if (responded) return;
    responded = true;
    if (isStreamingReq) {
      // If streaming has begun, send an error note and terminate stream
      try {
        // headers are set below before streaming branches
        res.write(`data: ${JSON.stringify({ error: { message: e?.message || "spawn error", type: "internal_server_error", code: "spawn_error" } })}\n\n`);
      } catch {}
      try { res.write("data: [DONE]\n\n"); res.end(); } catch {}
    } else {
      applyCors(null, res);
      res.status(500).json({ error: { message: e?.message || "spawn error", type: "internal_server_error", code: "spawn_error" } });
      appendUsage({ ts: Date.now(), req_id: reqId, route: "/v1/chat/completions", method: "POST", requested_model: requestedModel, effective_model: effectiveModel, stream: !!isStreamingReq, prompt_tokens_est: promptTokensEst, completion_tokens_est: 0, total_tokens_est: promptTokensEst, duration_ms: Date.now()-started, status: 500, user_agent: req.headers["user-agent"] || "" });
    }
  };
  child.on("error", onChildError);
  const timeout = setTimeout(() => {
    if (responded) return;
    onChildError(new Error("request timeout"));
    try { child.kill("SIGKILL"); } catch {}
  }, REQ_TIMEOUT_MS);
  let idleTimer;
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (responded) return;
      try { console.log("[proxy] idle timeout reached; terminating child"); } catch {}
      if (isStreamingReq) {
        try {
          res.write(`data: ${JSON.stringify({ error: { message: "backend idle timeout", type: "timeout_error", code: "idle_timeout" } })}\n\n`);
        } catch {}
        try { res.write("data: [DONE]\n\n"); res.end(); } catch {}
      } else {
        applyCors(null, res);
        res.status(504).json({ error: { message: "backend idle timeout", type: "timeout_error", code: "idle_timeout" } });
      }
      responded = true;
      try { child.kill("SIGTERM"); } catch {}
    }, IDLE_TIMEOUT_MS);
  };
  resetIdle();
  req.on("close", () => {
    if (responded) return;
    if (KILL_ON_DISCONNECT) { try { child.kill("SIGTERM"); } catch {} }
  });

  // Defer writing submission until after listeners are attached

  let out = "", err = "";

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
      if (sent) return; sent = true;
      sendSSE({
        id: `chatcmpl-${nanoid()}`,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: requestedModel,
        choices: [{ index: 0, delta: { role: "assistant" } }]
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
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    if (idleTimer) { try { clearTimeout(idleTimer); } catch {} }
    let keepalive; if (SSE_KEEPALIVE_MS > 0) keepalive = setInterval(() => { try { sendSSEKeepalive(); } catch {} }, SSE_KEEPALIVE_MS);
    sendRoleOnce();
    let buf = ""; let sentAny = false; let accum = ""; const includeUsage = !!(body?.stream_options?.include_usage || body?.include_usage);
    const resetStreamIdle = (() => { let t; return () => { if (t) clearTimeout(t); t = setTimeout(() => { try { child.kill("SIGTERM"); } catch {} }, STREAM_IDLE_TIMEOUT_MS); }; })();
    resetStreamIdle();
    child.stdout.on("data", (chunk) => {
      resetStreamIdle(); const s = chunk.toString("utf8"); out += s; buf += s;
      let idx; while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx); buf = buf.slice(idx+1);
        const trimmed = line.trim(); if (!trimmed) continue;
        try {
          const evt = JSON.parse(trimmed); const t = (evt && (evt.msg?.type || evt.type)) || "";
          if (t === "session_configured" || t === "task_started" || t === "agent_reasoning_delta") { continue; }
          if (t === "agent_message_delta") {
            const d = String((evt.msg?.delta ?? evt.delta) || "");
            if (d) {
              // Handle implementations that repeat full content as "delta"
              let toEmit = d;
              if (accum && d.startsWith(accum)) toEmit = d.slice(accum.length);
              if (toEmit) {
                sentAny = true;
                accum = d;
                sendSSE({ id: `chatcmpl-${nanoid()}`, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model: requestedModel, choices: [{ index: 0, delta: { content: toEmit } }] });
              }
            }
          } else if (t === "agent_message") {
            const m = String((evt.msg?.message ?? evt.message) || "");
            // If deltas already streamed, skip full message to avoid duplication
            if (m && !sentAny) {
              let toEmit = m;
              if (accum && m.startsWith(accum)) toEmit = m.slice(accum.length);
              if (toEmit) {
                sentAny = true;
                accum = m;
                sendSSE({ id: `chatcmpl-${nanoid()}`, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model: requestedModel, choices: [{ index: 0, delta: { content: toEmit } }] });
              }
            }
          } else if (t === "token_count" && includeUsage) {
            const pt = Number(evt.msg?.prompt_tokens || 0); const ct = Number(evt.msg?.completion_tokens || 0); sendSSE({ event: "usage", usage: { prompt_tokens: pt, completion_tokens: ct, total_tokens: pt + ct } });
          } else if (t === "task_complete") {
            // Finish stream immediately on task completion
            try { finishSSE(); } catch {}
            try { child.kill("SIGTERM"); } catch {}
            return;
          } else if (t === "error") {
            if (process.env.PROXY_DEBUG_PROTO) try { console.log("[proto] error event"); } catch {}
          }
        } catch (e) { if (process.env.PROXY_DEBUG_PROTO) try { console.log("[proto] parse error line:", trimmed); } catch {} }
      }
    });
    child.stderr.on("data", () => { resetStreamIdle(); });
    // Write submission after listeners are attached
    try {
      const submission = { id: reqId, op: { type: "user_input", items: [{ type: "text", text: prompt }] } };
      child.stdin.write(JSON.stringify(submission) + "\n");
    } catch {}
    child.on("close", () => { if (keepalive) clearInterval(keepalive); if (!sentAny) { const content = stripAnsi(out).trim() || "No output from backend."; sendSSE({ id: `chatcmpl-${nanoid()}`, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model: requestedModel, choices: [{ index: 0, delta: { content } }] }); } finishSSE(); });
    return;
  }

  // Non-streaming (proto): assemble content until task completion
  if (idleTimer) { try { clearTimeout(idleTimer); } catch {} }
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (idleTimer) { try { clearTimeout(idleTimer); } catch {} }
  let buf2 = ""; let content = ""; let prompt_tokens = 0; let completion_tokens = 0; let done = false;
  const resetProtoIdle = (() => { let t; return () => { if (t) clearTimeout(t); t = setTimeout(() => { if (responded) return; responded = true; try { child.kill("SIGTERM"); } catch {}; applyCors(null, res); res.status(504).json({ error: { message: "backend idle timeout", type: "timeout_error", code: "idle_timeout" } }); }, PROTO_IDLE_MS); }; })();
  resetProtoIdle();
  child.stdout.on("data", (d) => {
    resetProtoIdle(); const s= typeof d === "string" ? d : d.toString("utf8"); out += s; buf2 += s;
    let idx; while ((idx = buf2.indexOf("\n")) >= 0) {
      const line = buf2.slice(0, idx); buf2 = buf2.slice(idx+1);
      const t = line.trim(); if (!t) continue;
      try {
        const evt = JSON.parse(t); const tp = (evt && (evt.msg?.type || evt.type)) || "";
        if (DEBUG_PROTO) try { console.log("[proto] evt:", tp); } catch {}
        if (tp === "agent_message_delta") content += String((evt.msg?.delta ?? evt.delta) || "");
        else if (tp === "agent_message") content = String((evt.msg?.message ?? evt.message) || content);
        else if (tp === "token_count") { prompt_tokens = Number(evt.msg?.prompt_tokens || prompt_tokens); completion_tokens = Number(evt.msg?.completion_tokens || completion_tokens); }
        else if (tp === "task_complete") {
          done = true;
          if (!responded) {
            responded = true;
            applyCors(null, res);
            const final = content || stripAnsi(out).trim() || stripAnsi(err).trim() || "No output from backend.";
            res.json({ id: `chatcmpl-${nanoid()}`, object: "chat.completion", created: Math.floor(Date.now()/1000), model: requestedModel, choices: [{ index: 0, message: { role: "assistant", content: final }, finish_reason: "stop" }] });
            try { child.stdin.write(JSON.stringify({ id: nanoid(), op: { type: "shutdown" } }) + "\n"); } catch {}
            try { child.kill("SIGTERM"); } catch {}
          }
        }
      } catch {}
    }
  });
  child.stderr.on("data", () => { resetProtoIdle(); });
  // Write submission after listeners are attached
  try {
    const submission = { id: reqId, op: { type: "user_input", items: [{ type: "text", text: prompt }] } };
    child.stdin.write(JSON.stringify(submission) + "\n");
  } catch {}
  child.on("close", () => {
    if (responded) return; responded = true;
    clearTimeout(timeout);
    if (idleTimer) clearTimeout(idleTimer);
    const final = content || stripAnsi(out).trim() || stripAnsi(err).trim() || "No output from backend.";
    applyCors(null, res);
    const pt = prompt_tokens || promptTokensEst; const ct = completion_tokens || estTokens(final);
    res.json({ id: `chatcmpl-${nanoid()}`, object: "chat.completion", created: Math.floor(Date.now()/1000), model: requestedModel, choices: [{ index: 0, message: { role: "assistant", content: final }, finish_reason: done ? "stop" : "length" }], usage: { prompt_tokens: pt, completion_tokens: ct, total_tokens: pt + ct } });
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
  try { console.log("[completions] POST /v1/completions received"); } catch {}
  let responded = false;
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token !== API_KEY) {
    applyCors(null, res);
    return res
      .status(401)
      .set("WWW-Authenticate", "Bearer realm=api")
      .json({ error: { message: "unauthorized", type: "authentication_error", code: "invalid_api_key" } });
  }

  const body = req.body || {};
  try { console.log("[completions] body keys=", Object.keys(body || {})); } catch {}
  const prompt = Array.isArray(body.prompt) ? body.prompt.join("\n") : (body.prompt || "");
  if (!prompt) {
    applyCors(null, res);
    return res.status(400).json({ error: { message: "prompt required", type: "invalid_request_error", param: "prompt", code: "invalid_request_error" } });
  }

  const { requested: requestedModel, effective: effectiveModel } = normalizeModel(body.model || DEFAULT_MODEL);
  try { console.log(`[proxy] completions model requested=${requestedModel} effective=${effectiveModel} stream=${!!body.stream}`); } catch {}
  if (body.model && !ALLOWED_MODEL_IDS.has(requestedModel)) {
    applyCors(null, res);
    return res.status(404).json({
      error: {
        message: `The model ${requestedModel} does not exist or you do not have access to it.`,
        type: "invalid_request_error",
        param: "model",
        code: "model_not_found"
      }
    });
  }

  let reasoningEffort = (
    (body.reasoning?.effort || body.reasoning_effort || body.reasoningEffort || "")
      .toString()
      .toLowerCase()
  );
  const allowEffort = new Set(["low", "medium", "high", "minimal"]);
  if (!reasoningEffort) {
    const implied = impliedEffortForModel(requestedModel);
    if (implied) reasoningEffort = implied;
  }

  const isStreamingReq = !!body.stream;
  const args = [
    "proto",
    "--config", 'preferred_auth_method="chatgpt"',
    "--config", "project_doc_max_bytes=0",
    "--config", 'history.persistence="none"',
    "--config", 'tools.web_search=false',
    "--config", `model="${effectiveModel}"`
  ];
  if (FORCE_PROVIDER) args.push("--config", `model_provider="${FORCE_PROVIDER}"`);
  if (allowEffort.has(reasoningEffort)) {
    args.push("--config", `model_reasoning_effort="${reasoningEffort}"`);
    args.push("--config", `reasoning.effort="${reasoningEffort}"`);
  }

  const messages = [{ role: "user", content: prompt }];
  const toSend = joinMessages(messages);

  try { console.log("[proxy] spawning (proto completions):", CODEX_BIN, args.join(" "), " prompt_len=", toSend.length); } catch {}
  const child = spawn(CODEX_BIN, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, CODEX_HOME },
  });
  const onChildError = (e) => {
    try { console.log("[proxy] child error (completions):", e?.message || String(e)); } catch {}
    if (responded) return;
    responded = true;
    if (isStreamingReq) {
      try {
        res.write(`data: ${JSON.stringify({ error: { message: e?.message || "spawn error", type: "internal_server_error", code: "spawn_error" } })}\n\n`);
      } catch {}
      try { res.write("data: [DONE]\n\n"); res.end(); } catch {}
    } else {
      applyCors(null, res);
      res.status(500).json({ error: { message: e?.message || "spawn error", type: "internal_server_error", code: "spawn_error" } });
    }
  };
  child.on("error", onChildError);
  const timeout = setTimeout(() => {
    if (responded) return;
    onChildError(new Error("request timeout"));
    try { child.kill("SIGKILL"); } catch {}
  }, REQ_TIMEOUT_MS);
  let idleTimerCompletions;
  const resetIdleCompletions = () => {
    if (idleTimerCompletions) clearTimeout(idleTimerCompletions);
    idleTimerCompletions = setTimeout(() => {
      if (responded) return;
      try { console.log("[proxy] completions idle timeout; terminating child"); } catch {}
      if (isStreamingReq) {
        try {
          res.write(`data: ${JSON.stringify({ error: { message: "backend idle timeout", type: "timeout_error", code: "idle_timeout" } })}\n\n`);
        } catch {}
        try { res.write("data: [DONE]\n\n"); res.end(); } catch {}
      } else {
        applyCors(null, res);
        res.status(504).json({ error: { message: "backend idle timeout", type: "timeout_error", code: "idle_timeout" } });
      }
      responded = true;
      try { child.kill("SIGTERM"); } catch {}
    }, IDLE_TIMEOUT_MS);
  };
  resetIdleCompletions();
  req.on("close", () => {
    if (responded) return;
    if (KILL_ON_DISCONNECT) { try { child.kill("SIGTERM"); } catch {} }
  });
  try {
    const submission = { id: reqId, op: { type: "user_input", items: [{ type: "text", text: toSend }] } };
    child.stdin.write(JSON.stringify(submission) + "\n");
  } catch {}

  let out = "", err = "";
  const sendSSE = (payload) => { res.write(`data: ${JSON.stringify(payload)}\n\n`); };
  const finishSSE = () => { res.write("data: [DONE]\n\n"); res.end(); };

  if (isStreamingReq) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    let buf = ""; let sentAny = false; let completionChars = 0; let accum = "";
    child.stdout.on("data", (chunk) => {
      resetIdleCompletions();
      const text = chunk.toString("utf8"); out += text; buf += text;
      let idx; while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
        const trimmed = line.trim(); if (!trimmed) continue;
        try {
          const evt = JSON.parse(trimmed);
          const t = (evt && (evt.msg?.type || evt.type)) || "";
          if (t === "agent_message_delta") {
            const delta = String((evt.msg?.delta ?? evt.delta) || "");
            if (delta) {
              let toEmit = delta;
              if (accum && delta.startsWith(accum)) toEmit = delta.slice(accum.length);
              if (toEmit) {
                sentAny = true; accum = delta; completionChars += toEmit.length;
                sendSSE({ id: `cmpl-${nanoid()}`, object: "text_completion.chunk", created: Math.floor(Date.now()/1000), model: requestedModel, choices: [{ index: 0, text: toEmit }] });
              }
            }
          } else if (t === "agent_message") {
            const message = String((evt.msg?.message ?? evt.message) || "");
            if (message && !sentAny) {
              let toEmit = message;
              if (accum && message.startsWith(accum)) toEmit = message.slice(accum.length);
              if (toEmit) {
                sentAny = true; accum = message; completionChars += toEmit.length;
                sendSSE({ id: `cmpl-${nanoid()}`, object: "text_completion.chunk", created: Math.floor(Date.now()/1000), model: requestedModel, choices: [{ index: 0, text: toEmit }] });
              }
            }
          }
        } catch {}
      }
    });
    child.stderr.on("data", (e) => { resetIdleCompletions(); const s=e.toString("utf8"); err += s; try { console.log("[proxy] child stderr:", s.trim()); } catch {} });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (idleTimerCompletions) clearTimeout(idleTimerCompletions);
      if (!sentAny) {
        const content = stripAnsi(out).trim() || "No output from backend.";
        sendSSE({ id: `cmpl-${nanoid()}`, object: "text_completion.chunk", created: Math.floor(Date.now()/1000), model: requestedModel, choices: [{ index: 0, text: content }] });
      }
      const completion_tokens_est = Math.ceil(completionChars / 4);
      appendUsage({ ts: Date.now(), req_id: reqId, route: "/v1/chat/completions", method: "POST", requested_model: requestedModel, effective_model: effectiveModel, stream: true, prompt_tokens_est: promptTokensEst, completion_tokens_est, total_tokens_est: promptTokensEst + completion_tokens_est, duration_ms: Date.now()-started, status: 200, user_agent: req.headers["user-agent"] || "" });
      finishSSE();
    });
    return;
  }
  

  // Non-streaming (proto): accumulate text
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  let bufN = ""; let content = ""; let prompt_tokens = 0; let completion_tokens = 0;
  child.stdout.on("data", (d) => {
    resetIdleCompletions(); const s=d.toString("utf8"); out += s; bufN += s;
    let idx; while ((idx = bufN.indexOf("\n")) >= 0) {
      const line = bufN.slice(0, idx); bufN = bufN.slice(idx+1);
      const t = line.trim(); if (!t) continue;
      try {
        const evt = JSON.parse(t); const tp = (evt && (evt.msg?.type || evt.type)) || "";
        if (tp === "agent_message_delta") content += String((evt.msg?.delta ?? evt.delta) || "");
        else if (tp === "agent_message") content = String((evt.msg?.message ?? evt.message) || content);
        else if (tp === "token_count") { prompt_tokens = Number(evt.msg?.prompt_tokens || prompt_tokens); completion_tokens = Number(evt.msg?.completion_tokens || completion_tokens); }
      } catch {}
    }
  });
  child.stderr.on("data", (d) => { resetIdleCompletions(); err += d.toString("utf8"); });
  child.on("close", () => {
    if (responded) return; responded = true;
    clearTimeout(timeout);
    if (idleTimerCompletions) clearTimeout(idleTimerCompletions);
    const textOut = content || stripAnsi(out).trim() || stripAnsi(err).trim() || "No output from backend.";
    applyCors(null, res);
    const pt = prompt_tokens || promptTokensEst; const ct = completion_tokens || estTokens(textOut);
    appendUsage({ ts: Date.now(), req_id: reqId, route: "/v1/chat/completions", method: "POST", requested_model: requestedModel, effective_model: effectiveModel, stream: false, prompt_tokens_est: pt, completion_tokens_est: ct, total_tokens_est: pt + ct, duration_ms: Date.now()-started, status: 200, user_agent: req.headers["user-agent"] || "" });
    res.json({ id: `cmpl-${nanoid()}`, object: "text_completion", created: Math.floor(Date.now()/1000), model: requestedModel, choices: [{ index: 0, text: textOut, logprobs: null, finish_reason: "stop" }], usage: { prompt_tokens: pt, completion_tokens: ct, total_tokens: pt + ct } });
  });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`codex-openai-proxy listening on http://127.0.0.1:${PORT}/v1`);
});
