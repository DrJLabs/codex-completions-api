import { spawn } from "node:child_process";
import path from "node:path";
import { nanoid } from "nanoid";
import {
  stripAnsi,
  estTokens,
  estTokensForMessages,
  joinMessages,
  impliedEffortForModel,
  normalizeModel,
  applyCors as applyCorsUtil,
} from "../../utils.js";
import { config as CFG } from "../../config/index.js";
import { acceptedModelIds } from "../../config/models.js";
import { authErrorBody, modelNotFoundBody } from "../../lib/errors.js";
import {
  appendUsage,
  appendProtoEvent,
  extractUseToolBlocks,
  LOG_PROTO,
} from "../../dev-logging.js";

const API_KEY = CFG.API_KEY;
const DEFAULT_MODEL = CFG.CODEX_MODEL;
const CODEX_BIN = CFG.CODEX_BIN;
const RESOLVED_CODEX_BIN = path.isAbsolute(CODEX_BIN)
  ? CODEX_BIN
  : CODEX_BIN.includes(path.sep)
    ? path.join(process.cwd(), CODEX_BIN)
    : CODEX_BIN;
const CODEX_HOME = CFG.CODEX_HOME;
const SANDBOX_MODE = CFG.PROXY_SANDBOX_MODE;
const CODEX_WORKDIR = CFG.PROXY_CODEX_WORKDIR;
const FORCE_PROVIDER = CFG.CODEX_FORCE_PROVIDER.trim();
const IS_DEV_ENV = (CFG.PROXY_ENV || "").toLowerCase() === "dev";
const ACCEPTED_MODEL_IDS = acceptedModelIds(DEFAULT_MODEL);
const REQ_TIMEOUT_MS = CFG.PROXY_TIMEOUT_MS;
const PROTO_IDLE_MS = CFG.PROXY_PROTO_IDLE_MS;
const KILL_ON_DISCONNECT = CFG.PROXY_KILL_ON_DISCONNECT.toLowerCase() !== "false";
const CORS_ENABLED = CFG.PROXY_ENABLE_CORS.toLowerCase() !== "false";
const applyCors = (req, res) => applyCorsUtil(req, res, CORS_ENABLED);

// POST /v1/chat/completions with stream=false
export async function postChatNonStream(req, res) {
  const reqId = nanoid();
  const started = Date.now();
  let responded = false;

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token !== API_KEY) {
    applyCors(null, res);
    return res.status(401).set("WWW-Authenticate", "Bearer realm=api").json(authErrorBody());
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
  if (FORCE_PROVIDER) args.push("--config", `model_provider="${FORCE_PROVIDER}` + `"`);
  if (allowEffort.has(reasoningEffort)) {
    args.push("--config", `model_reasoning_effort="${reasoningEffort}"`);
    args.push("--config", `reasoning.effort="${reasoningEffort}"`);
  }

  const prompt = joinMessages(messages);
  const promptTokensEst = estTokensForMessages(messages);

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

  const child = spawn(RESOLVED_CODEX_BIN, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, CODEX_HOME },
    cwd: CODEX_WORKDIR,
  });
  let out = "",
    err = "";

  const timeout = setTimeout(() => {
    if (responded) return;
    responded = true;
    try {
      child.kill("SIGKILL");
    } catch {}
    applyCors(null, res);
    res.status(504).json({
      error: { message: "backend idle timeout", type: "timeout_error", code: "idle_timeout" },
    });
  }, REQ_TIMEOUT_MS);

  res.setHeader("Content-Type", "application/json; charset=utf-8");
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
        if (tp === "agent_message_delta") content += String((evt.msg?.delta ?? evt.delta) || "");
        else if (tp === "agent_message")
          content = String((evt.msg?.message ?? evt.message) || content);
        else if (tp === "token_count") {
          prompt_tokens = Number(evt.msg?.prompt_tokens || prompt_tokens);
          completion_tokens = Number(evt.msg?.completion_tokens || completion_tokens);
        } else if (tp === "task_complete") {
          done = true;
        }
      } catch {}
    }
  });
  child.stderr.on("data", (d) => {
    resetProtoIdle();
    err += d.toString("utf8");
    if (LOG_PROTO)
      appendProtoEvent({
        ts: Date.now(),
        req_id: reqId,
        route: "/v1/chat/completions",
        mode: "chat_nonstream",
        kind: "stderr",
        chunk: d.toString("utf8"),
      });
  });
  child.on("close", () => {
    if (responded) return;
    responded = true;
    clearTimeout(timeout);
    const final =
      content || stripAnsi(out).trim() || stripAnsi(err).trim() || "No output from backend.";
    applyCors(null, res);
    const pt = prompt_tokens || promptTokensEst;
    const ct = completion_tokens || estTokens(final);
    try {
      // Log tool blocks for debugging/analysis
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
  try {
    const submission = {
      id: reqId,
      op: { type: "user_input", items: [{ type: "text", text: prompt }] },
    };
    child.stdin.write(JSON.stringify(submission) + "\n");
  } catch {}
  req.on("close", () => {
    if (KILL_ON_DISCONNECT) {
      try {
        child.kill("SIGTERM");
      } catch {}
    }
  });
}

// POST /v1/completions with stream=false
export async function postCompletionsNonStream(req, res) {
  const reqId = nanoid();
  const started = Date.now();
  let responded = false;

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token !== API_KEY) {
    applyCors(null, res);
    return res.status(401).set("WWW-Authenticate", "Bearer realm=api").json(authErrorBody());
  }

  const body = req.body || {};
  const prompt = Array.isArray(body.prompt) ? body.prompt.join("\n") : body.prompt || "";
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
  if (FORCE_PROVIDER) args.push("--config", `model_provider="${FORCE_PROVIDER}` + `"`);
  if (allowEffort.has(reasoningEffort)) {
    args.push("--config", `model_reasoning_effort="${reasoningEffort}"`);
    args.push("--config", `reasoning.effort="${reasoningEffort}"`);
  }

  const messages = [{ role: "user", content: prompt }];
  const toSend = joinMessages(messages);
  const promptTokensEst = estTokensForMessages(messages);

  const child = spawn(RESOLVED_CODEX_BIN, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, CODEX_HOME },
    cwd: CODEX_WORKDIR,
  });
  let out = "",
    err = "";

  const timeout = setTimeout(() => {
    if (responded) return;
    responded = true;
    try {
      child.kill("SIGKILL");
    } catch {}
    applyCors(null, res);
    res.status(504).json({
      error: { message: "backend idle timeout", type: "timeout_error", code: "idle_timeout" },
    });
  }, REQ_TIMEOUT_MS);

  let bufN = "";
  let content = "";
  let prompt_tokens = 0;
  let completion_tokens = 0;

  child.stdout.on("data", (d) => {
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
    const textOut =
      content || stripAnsi(out).trim() || stripAnsi(err).trim() || "No output from backend.";
    applyCors(null, res);
    const pt = prompt_tokens || promptTokensEst;
    const ct = completion_tokens || estTokens(textOut);
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

  try {
    const submission = {
      id: reqId,
      op: { type: "user_input", items: [{ type: "text", text: toSend }] },
    };
    child.stdin.write(JSON.stringify(submission) + "\n");
  } catch {}
}
