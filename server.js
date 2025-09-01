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
const STREAM_MODE = (process.env.PROXY_STREAM_MODE || "incremental").toLowerCase();
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

  const outputFile = path.join(os.tmpdir(), `codex-last-${nanoid()}.txt`);
  const isStreamingReq = !!body.stream && ["incremental", "json", "jsonlines", "jsonl"].includes(STREAM_MODE);
  const args = [
    "exec",
    "--sandbox", "read-only",
    "--config", 'preferred_auth_method="chatgpt"',
    "--skip-git-repo-check",
    "--output-last-message", outputFile,
    "-m", effectiveModel
  ];
  // Prefer JSONL event stream when requested; this enables robust incremental SSE mapping
  const useJsonl = isStreamingReq && ["json", "jsonlines", "jsonl"].includes(STREAM_MODE);
  if (useJsonl) args.push("--json");
  // For streaming we avoid --json due to observed child termination in some environments.
  // Attempt to set reasoning via config if supported
  if (allowEffort.has(reasoningEffort)) {
    // Prefer newer codex-cli config key; keep legacy key for backward compatibility
    args.push("--config", `model_reasoning_effort="${reasoningEffort}"`);
    args.push("--config", `reasoning.effort="${reasoningEffort}"`);
  }

  const prompt = joinMessages(messages);
  const promptTokensEst = estTokensForMessages(messages);

  try { console.log("[proxy] spawning:", CODEX_BIN, args.join(" "), " prompt_len=", prompt.length); } catch {}
  const child = spawn(CODEX_BIN, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });
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

  try {
    const toWrite = prompt.endsWith("\n") ? prompt : `${prompt}\n`;
    child.stdin.write(toWrite);
    child.stdin.end();
  } catch {}

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
    // Stream role first; send content on process close from last-message file
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.flushHeaders?.();
    // Keepalive pings to keep the connection warm across proxies
    let keepalive;
    if (SSE_KEEPALIVE_MS > 0) {
      keepalive = setInterval(() => {
        try { sendSSEKeepalive(); } catch {}
      }, SSE_KEEPALIVE_MS);
    }

    const promptText = joinMessages(messages).trim();
    // Clear generic idle timer; streaming uses its own idle management
    if (idleTimer) { try { clearTimeout(idleTimer); } catch {} }
    if (useJsonl) {
      // Emit role immediately to satisfy clients expecting role-first chunk
      sendRoleOnce();
      // Parse JSONL event stream from Codex and map to OpenAI SSE deltas
      let buf = "";
      let sentContentDelta = false;
      const streamResetIdle = (() => {
        let timer;
        return () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            if (responded) return;
            try { console.log("[proxy] stream idle timeout (jsonl); terminating backend"); } catch {}
            try { child.kill("SIGTERM"); } catch {}
            try { res.write(`data: ${JSON.stringify({ error: { message: "backend idle timeout", type: "timeout_error", code: "idle_timeout" } })}\n\n`); } catch {}
          }, STREAM_IDLE_TIMEOUT_MS);
        };
      })();
      streamResetIdle();
      child.stdout.on("data", (chunk) => {
        streamResetIdle();
        const text = chunk.toString("utf8");
        out += text;
        buf += text;
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const evt = JSON.parse(trimmed);
            const t = (evt && (evt.msg?.type || evt.type)) || "";
            if (t === "agent_message_delta") {
              const delta = (evt.msg?.delta ?? evt.delta) || "";
              if (delta) {
                sendRoleOnce();
                sendSSE({
                  id: `chatcmpl-${nanoid()}`,
                  object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model: requestedModel,
                  choices: [{ index: 0, delta: { content: String(delta) } }]
                });
                sentContentDelta = true;
              }
            } else if (t === "agent_message") {
              // Newer Codex versions may emit full messages but not deltas.
              // Stream the full message immediately instead of waiting for process close.
              const message = (evt.msg?.message ?? evt.message) || "";
              if (message) {
                sendRoleOnce();
                sendSSE({
                  id: `chatcmpl-${nanoid()}`,
                  object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model: requestedModel,
                  choices: [{ index: 0, delta: { content: String(message) } }]
                });
                sentContentDelta = true;
              }
            } else if (t === "task_complete") {
              // Will be followed by ShutdownComplete; safe to finish
              // Emit a no-op delta to ensure role was sent
              sendRoleOnce();
            }
          } catch {
            // Non-JSON lines are ignored in jsonl mode
          }
        }
      });
      child.stderr.on("data", (e) => { streamResetIdle(); const s = e.toString("utf8"); err += s; try { console.log("[proxy] child stderr:", s.trim()); } catch {} });
      child.on("close", (code, signal) => {
        clearTimeout(timeout);
        if (keepalive) clearInterval(keepalive);
        if (idleTimer) clearTimeout(idleTimer);
        if (!sentContentDelta) {
          // Fallback: if no incremental content was sent, emit final content once
          let content = "";
          try {
            if (fs.existsSync(outputFile)) {
              content = fs.readFileSync(outputFile, "utf8");
              fs.unlinkSync(outputFile);
            }
          } catch {}
          if (!content) content = stripAnsi(out).trim();
          if (!content) content = "No output from backend.";
          sendRoleOnce();
          sendSSE({
            id: `chatcmpl-${nanoid()}`,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: requestedModel,
            choices: [{ index: 0, delta: { content } }]
          });
        }
        try { console.log("[proxy] jsonl stream close: code=", code, " out_len=", out.length, " err_len=", err.length); } catch {}
        finishSSE();
      });
    } else {
      // Fallback incremental mode: emit one chunk with final content
      // Emit role immediately to satisfy clients expecting role-first chunk
      sendRoleOnce();
      // For streaming, use a longer idle window to accommodate long-thinking phases
      const streamResetIdle = (() => {
        let timer;
        return () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            if (responded) return;
            try { console.log("[proxy] stream idle timeout; keeping connection but terminating backend"); } catch {}
            try { child.kill("SIGTERM"); } catch {}
            // Inform client but keep connection open briefly for [DONE]
            try { res.write(`data: ${JSON.stringify({ error: { message: "backend idle timeout", type: "timeout_error", code: "idle_timeout" } })}\n\n`); } catch {}
          }, STREAM_IDLE_TIMEOUT_MS);
        };
      })();
      streamResetIdle();
      child.stdout.on("data", (chunk) => { streamResetIdle(); out += chunk.toString("utf8"); });
      child.stderr.on("data", (e) => { streamResetIdle(); const s = e.toString("utf8"); err += s; try { console.log("[proxy] child stderr:", s.trim()); } catch {} });
      child.on("close", (code, signal) => {
        clearTimeout(timeout);
        if (keepalive) clearInterval(keepalive);
        if (idleTimer) clearTimeout(idleTimer);
        let content = "";
        try {
          if (fs.existsSync(outputFile)) {
            content = fs.readFileSync(outputFile, "utf8");
            fs.unlinkSync(outputFile);
          }
        } catch {}
        if (!content) content = stripAnsi(out).trim();
        try { console.log("[proxy] stream close: code=", code, " content_len=", (content ? content.length : 0), " out_len=", out.length, " err_len=", err.length, " err=", err.slice(0,200)); } catch {}
        if (!content) content = "No output from backend.";
        sendRoleOnce();
        sendSSE({
          id: `chatcmpl-${nanoid()}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: requestedModel,
          choices: [{ index: 0, delta: { content } }]
        });
        finishSSE();
      });
    }
    // Do not kill child on client disconnect; allow graceful completion
    // req.on("close", () => { try { child.kill("SIGTERM"); } catch {} });
    return;
  }

  // Non-streaming fallback
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  child.stdout.on("data", (d) => { resetIdle(); out += d.toString("utf8"); });
  child.stderr.on("data", (d) => { resetIdle(); err += d.toString("utf8"); });
  child.on("close", (code) => {
    clearTimeout(timeout);
    if (idleTimer) clearTimeout(idleTimer);
    let content = "";
    try {
      if (fs.existsSync(outputFile)) {
        content = fs.readFileSync(outputFile, "utf8");
        fs.unlinkSync(outputFile);
      }
    } catch {}
    if (!content) {
      content = stripAnsi(out).trim();
    }
    if (!content) {
      // Fallback to stderr or a minimal message to satisfy clients expecting an assistant message
      content = stripAnsi(err).trim() || "No output from backend.";
    }
    applyCors(null, res);
    res.json({
      id: `chatcmpl-${nanoid()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: requestedModel,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
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

  const outputFile = path.join(os.tmpdir(), `codex-last-${nanoid()}.txt`);
  const isStreamingReq = !!body.stream && ["incremental", "json", "jsonlines", "jsonl"].includes(STREAM_MODE);
  const args = [
    "exec",
    "--sandbox", "read-only",
    "--config", 'preferred_auth_method="chatgpt"',
    "--skip-git-repo-check",
    "--output-last-message", outputFile,
    "-m", effectiveModel
  ];
  const useJsonl = isStreamingReq && ["json", "jsonlines", "jsonl"].includes(STREAM_MODE);
  if (useJsonl) args.push("--json");
  if (allowEffort.has(reasoningEffort)) {
    args.push("--config", `model_reasoning_effort="${reasoningEffort}"`);
    args.push("--config", `reasoning.effort="${reasoningEffort}"`);
  }

  const messages = [{ role: "user", content: prompt }];
  const toSend = joinMessages(messages);

  try { console.log("[proxy] spawning (completions):", CODEX_BIN, args.join(" "), " prompt_len=", toSend.length); } catch {}
  const child = spawn(CODEX_BIN, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
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
    const toWrite = toSend.endsWith("\n") ? toSend : `${toSend}\n`;
    child.stdin.write(toWrite);
    child.stdin.end();
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

    if (useJsonl) {
      let buf = "";
      let sentAny = false;
      let completionChars = 0;
      child.stdout.on("data", (chunk) => {
        resetIdleCompletions();
        const text = chunk.toString("utf8");
        out += text; buf += text;
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
          const trimmed = line.trim(); if (!trimmed) continue;
          try {
            const evt = JSON.parse(trimmed);
            const t = (evt && (evt.msg?.type || evt.type)) || "";
            if (t === "agent_message_delta") {
              const delta = (evt.msg?.delta ?? evt.delta) || "";
              if (delta) {
                sentAny = true;
                completionChars += String(delta).length;
                sendSSE({
                  id: `cmpl-${nanoid()}`,
                  object: "text_completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model: requestedModel,
                  choices: [{ index: 0, text: String(delta) }]
                });
              }
            } else if (t === "agent_message") {
              const message = (evt.msg?.message ?? evt.message) || "";
              if (message) {
                sentAny = true;
                completionChars += String(message).length;
                sendSSE({
                  id: `cmpl-${nanoid()}`,
                  object: "text_completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model: requestedModel,
                  choices: [{ index: 0, text: String(message) }]
                });
              }
            }
          } catch {}
        }
      });
      child.stderr.on("data", (e) => { resetIdleCompletions(); const s = e.toString("utf8"); err += s; try { console.log("[proxy] child stderr:", s.trim()); } catch {} });
      child.on("close", (code) => {
        clearTimeout(timeout);
        if (idleTimerCompletions) clearTimeout(idleTimerCompletions);
        if (!sentAny) {
          let content = "";
          try {
            if (fs.existsSync(outputFile)) {
              content = fs.readFileSync(outputFile, "utf8");
              fs.unlinkSync(outputFile);
            }
          } catch {}
          if (!content) content = stripAnsi(out).trim();
          if (!content) content = "No output from backend.";
          sendSSE({
            id: `cmpl-${nanoid()}`,
            object: "text_completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: requestedModel,
            choices: [{ index: 0, text: content }]
          });
        }
        const completion_tokens_est = Math.ceil(completionChars / 4);
        appendUsage({ ts: Date.now(), req_id: reqId, route: "/v1/chat/completions", method: "POST", requested_model: requestedModel, effective_model: effectiveModel, stream: true, prompt_tokens_est: promptTokensEst, completion_tokens_est, total_tokens_est: promptTokensEst + completion_tokens_est, duration_ms: Date.now()-started, status: 200, user_agent: req.headers["user-agent"] || "" });
        finishSSE();
      });
      return;
    }

    // Fallback streaming: send final text as a single chunk
    let completionChars = 0;
    child.stdout.on("data", (d) => { resetIdleCompletions(); const s=d.toString("utf8"); out += s; completionChars += s.length; });
    child.stderr.on("data", (d) => { resetIdleCompletions(); err += d.toString("utf8"); });
    child.on("close", () => {
      clearTimeout(timeout);
      if (idleTimerCompletions) clearTimeout(idleTimerCompletions);
      let content = "";
      try {
        if (fs.existsSync(outputFile)) {
          content = fs.readFileSync(outputFile, "utf8");
          fs.unlinkSync(outputFile);
        }
      } catch {}
      if (!content) content = stripAnsi(out).trim();
      if (!content) content = "No output from backend.";
      const completion_tokens_est = Math.ceil(completionChars/4);
      appendUsage({ ts: Date.now(), req_id: reqId, route: "/v1/chat/completions", method: "POST", requested_model: requestedModel, effective_model: effectiveModel, stream: true, prompt_tokens_est: promptTokensEst, completion_tokens_est, total_tokens_est: promptTokensEst + completion_tokens_est, duration_ms: Date.now()-started, status: 200, user_agent: req.headers["user-agent"] || "" });
      sendSSE({
        id: `cmpl-${nanoid()}`,
        object: "text_completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: requestedModel,
        choices: [{ index: 0, text: content }]
      });
      finishSSE();
    });
    return;
  }

  // Non-streaming
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  child.stdout.on("data", (d) => { resetIdleCompletions(); out += d.toString("utf8"); });
  child.stderr.on("data", (d) => { resetIdleCompletions(); err += d.toString("utf8"); });
  child.on("close", (code) => {
    clearTimeout(timeout);
    if (idleTimerCompletions) clearTimeout(idleTimerCompletions);
    let content = "";
    try {
      if (fs.existsSync(outputFile)) {
        content = fs.readFileSync(outputFile, "utf8");
        fs.unlinkSync(outputFile);
      }
    } catch {}
    if (!content) content = stripAnsi(out).trim();
    if (!content) content = stripAnsi(err).trim() || "No output from backend.";
    applyCors(null, res);
    const completion_tokens_est = estTokens(content);
    appendUsage({ ts: Date.now(), req_id: reqId, route: "/v1/chat/completions", method: "POST", requested_model: requestedModel, effective_model: effectiveModel, stream: false, prompt_tokens_est: promptTokensEst, completion_tokens_est, total_tokens_est: promptTokensEst + completion_tokens_est, duration_ms: Date.now()-started, status: 200, user_agent: req.headers["user-agent"] || "" });
    res.json({
      id: `cmpl-${nanoid()}`,
      object: "text_completion",
      created: Math.floor(Date.now() / 1000),
      model: requestedModel,
      choices: [{ index: 0, text: content, logprobs: null, finish_reason: "stop" }],
      usage: { prompt_tokens: promptTokensEst, completion_tokens: completion_tokens_est, total_tokens: promptTokensEst + completion_tokens_est }
    });
  });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`codex-openai-proxy listening on http://127.0.0.1:${PORT}/v1`);
});
