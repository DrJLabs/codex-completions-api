import express from "express";
import { spawn } from "node:child_process";
import { nanoid } from "nanoid";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const app = express();
app.use(express.json({ limit: "16mb" }));

const PORT = Number(process.env.PORT || 11435);
const API_KEY = process.env.PROXY_API_KEY || "codex-local-secret";
const DEFAULT_MODEL = process.env.CODEX_MODEL || "gpt-5";
const CODEX_BIN = process.env.CODEX_BIN || "codex";
const STREAM_MODE = (process.env.PROXY_STREAM_MODE || "incremental").toLowerCase();

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

app.get("/v1/models", (_req, res) => {
  res.json({ object: "list", data: [{ id: DEFAULT_MODEL, object: "model", created: 0, owned_by: "codex" }] });
});

// OpenAI-compatible Chat Completions endpoint backed by Codex CLI
app.post("/v1/chat/completions", (req, res) => {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token !== API_KEY) {
    return res.status(401).json({ error: { message: "unauthorized" } });
  }

  const body = req.body || {};
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) return res.status(400).json({ error: { message: "messages[] required" } });

  const model = String(body.model || DEFAULT_MODEL);
  const reasoningEffort = (
    (body.reasoning?.effort || body.reasoning_effort || body.reasoningEffort || "")
      .toString()
      .toLowerCase()
  );
  const allowEffort = new Set(["low", "medium", "high", "minimal"]);

  const outputFile = path.join(os.tmpdir(), `codex-last-${nanoid()}.txt`);
  const isStreamingReq = !!body.stream && STREAM_MODE === "incremental";
  const args = [
    "exec",
    "--sandbox", "read-only",
    "--config", 'preferred_auth_method="chatgpt"',
    "--skip-git-repo-check",
    "--output-last-message", outputFile,
    "-m", model
  ];
  // For streaming we avoid --json due to observed child termination in some environments.
  // Attempt to set reasoning via config if supported
  if (allowEffort.has(reasoningEffort)) {
    args.push("--config", `reasoning.effort="${reasoningEffort}"`);
  }

  const prompt = joinMessages(messages);

  try { console.log("[proxy] spawning:", CODEX_BIN, args.join(" "), " prompt_len=", prompt.length); } catch {}
  const child = spawn(CODEX_BIN, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
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

  const sendRoleOnce = (() => {
    let sent = false;
    return () => {
      if (sent) return; sent = true;
      sendSSE({
        id: `chatcmpl-${nanoid()}`,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model,
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
    res.flushHeaders?.();

    const promptText = joinMessages(messages).trim();
    // Emit role immediately to satisfy clients expecting role-first chunk
    sendRoleOnce();
    child.stdout.on("data", (chunk) => { out += chunk.toString("utf8"); });
    child.stderr.on("data", (e) => { const s = e.toString("utf8"); err += s; try { console.log("[proxy] child stderr:", s.trim()); } catch {} });
    child.on("close", (code, signal) => {
      let content = "";
      try {
        if (fs.existsSync(outputFile)) {
          content = fs.readFileSync(outputFile, "utf8");
          fs.unlinkSync(outputFile);
        }
      } catch {}
      if (!content) content = stripAnsi(out).trim();
      try { console.log("[proxy] stream close: code=", code, " content_len=", (content ? content.length : 0), " out_len=", out.length, " err_len=", err.length, " err=", err.slice(0,200)); } catch {}
      if (content) {
        sendRoleOnce();
        sendSSE({
          id: `chatcmpl-${nanoid()}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{ index: 0, delta: { content } }]
        });
      }
      finishSSE();
    });
    // Do not kill child on client disconnect; allow graceful completion
    // req.on("close", () => { try { child.kill("SIGTERM"); } catch {} });
    return;
  }

  // Non-streaming fallback
  child.stdout.on("data", (d) => { out += d.toString("utf8"); });
  child.stderr.on("data", (d) => { err += d.toString("utf8"); });
  child.on("close", (code) => {
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
    if (code !== 0 && !content) {
      return res.status(500).json({ error: { message: stripAnsi(err).trim() || `codex exited with ${code}` } });
    }
    res.json({
      id: `chatcmpl-${nanoid()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: null
    });
  });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`codex-openai-proxy listening on http://127.0.0.1:${PORT}/v1`);
});
