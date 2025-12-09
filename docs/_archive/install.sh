#!/usr/bin/env bash
set -euo pipefail

cat >&2 <<EOF
====================================================================
DEPRECATED: This installer is archived and unsupported.
Please use Docker Compose deployment instead.
See: https://github.com/DrJLabs/codex-completions-api#deployment-traefik--cloudflare-docker-compose
====================================================================
EOF
exit 1

# One-shot installer for Codex OpenAI-compatible proxy with systemd user service.
# Prereqs: Node >=22, npm, curl. Installs Codex CLI if missing.

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js >= 22 is required." >&2
  exit 1
fi

# Enforce Node >= 22 at runtime
EXPECTED_NODE_MAJOR=22
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt "$EXPECTED_NODE_MAJOR" ]; then
  echo "Node $(node -v) detected; please use Node >= $EXPECTED_NODE_MAJOR for this project." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required." >&2
  exit 1
fi

if ! command -v codex >/dev/null 2>&1; then
  npm i -g @openai/codex
fi
codex --version >/dev/null

# Prefer ChatGPT plan auth (explicitly set)
codex --config preferred_auth_method="chatgpt" >/dev/null 2>&1 || true

PROXY_DIR="${HOME}/.local/share/codex-openai-proxy"
mkdir -p "${PROXY_DIR}"
cd "${PROXY_DIR}"

# package.json
cat > package.json <<'JSON'
{
  "name": "codex-openai-proxy",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": { "start": "node server.js" },
  "dependencies": {
    "express": "^4.19.2",
    "nanoid": "^5.0.7"
  }
}
JSON

# server.js
cat > server.js <<'JS'
import express from "express";
import { spawn } from "node:child_process";
import { nanoid } from "nanoid";

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
  if (/^(diff --git|\+\+\+ |--- |@@ )/.test(l)) return false;
  if (/^\*\*\* (Begin|End) Patch/.test(l)) return false;
  if (/^(running:|command:|applying patch|reverted|workspace|approval|sandbox|tool:|mcp:|file:|path:)/i.test(l)) return false;
  return true;
};

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.get("/v1/models", (_req, res) => {
  res.json({ object: "list", data: [{ id: DEFAULT_MODEL, object: "model", created: 0, owned_by: "codex" }] });
});

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
    (body.reasoning?.effort || body.reasoning_effort || body.reasoningEffort || "").toString().toLowerCase()
  );
  const allowEffort = new Set(["low", "medium", "high", "minimal"]);

  const args = [
    "exec",
    "--ask-for-approval", "never",
    "--sandbox", "read-only",
    "--config", 'preferred_auth_method="chatgpt"',
    "-m", model
  ];
  if (allowEffort.has(reasoningEffort)) {
    args.push("--reasoning", reasoningEffort);
  }

  const prompt = joinMessages(messages);
  args.push(prompt);

  const child = spawn(CODEX_BIN, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } });

  let out = "", err = "";

  const sendSSE = (payload) => { res.write(`data: ${JSON.stringify(payload)}\n\n`); };
  const sendRoleOnce = (() => {
    let sent = false;
    return () => {
      if (sent) return; sent = true;
      sendSSE({ id: `chatcmpl-${nanoid()}`, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model, choices: [{ index: 0, delta: { role: "assistant" } }] });
    };
  })();

  const finishSSE = () => { res.write("data: [DONE]\n\n"); res.end(); };

  if (body.stream && (process.env.PROXY_STREAM_MODE || "incremental").toLowerCase() === "incremental") {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    child.stdout.on("data", (chunk) => {
      const clean = stripAnsi(chunk.toString("utf8"));
      for (const line of clean.split(/\n/)) {
        if (!line) continue;
        if (!isModelText(line)) continue;
        sendRoleOnce();
        sendSSE({ id: `chatcmpl-${nanoid()}`, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model, choices: [{ index: 0, delta: { content: line + "\n" } }] });
      }
      out += clean;
    });
    child.stderr.on("data", (e) => { err += e.toString("utf8"); });
    child.on("close", () => finishSSE());
    // abort on client disconnect
    req.on("close", () => { try { child.kill("SIGTERM"); } catch {} });
    return;
  }

  child.stdout.on("data", (d) => { out += d.toString("utf8"); });
  child.stderr.on("data", (d) => { err += d.toString("utf8"); });
  child.on("close", (code) => {
    const content = stripAnsi(out).trim();
    if (code !== 0 && !content) {
      return res.status(500).json({ error: { message: stripAnsi(err).trim() || `codex exited with ${code}` } });
    }
    res.json({
      id: `chatcmpl-${nanoid()}`,
      object: "chat.completion",
      created: Math.floor(Date.now()/1000),
      model,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: null
    });
  });
});

app.listen(PORT, () => {
  console.log(`codex-openai-proxy listening on http://127.0.0.1:${PORT}/v1`);
});
JS

npm i --omit=dev

mkdir -p "${HOME}/.config/systemd/user"
NODE_BIN="$(command -v node)"
CODEX_BIN_PATH="$(command -v codex)"
cat > "${HOME}/.config/systemd/user/codex-openai-proxy.service" <<SYSTEMD
[Unit]
Description=Codex OpenAI-compatible proxy (user)
After=network.target

[Service]
Environment=PORT=11435
Environment=PROXY_API_KEY=codex-local-secret
Environment=CODEX_MODEL=gpt-5
Environment=PROXY_STREAM_MODE=incremental
Environment=CODEX_BIN=${CODEX_BIN_PATH}
Environment=HOME=%h
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/bin
WorkingDirectory=${PROXY_DIR}
ExecStart=${NODE_BIN} ${PROXY_DIR}/server.js
Restart=on-failure

[Install]
WantedBy=default.target
SYSTEMD

systemctl --user daemon-reload
systemctl --user enable --now codex-openai-proxy.service

sleep 0.5
curl -sf http://127.0.0.1:11435/healthz >/dev/null

curl -sN http://127.0.0.1:11435/v1/chat/completions \
  -H 'Authorization: Bearer codex-local-secret' \
  -H 'Content-Type: application/json' \
  -d '{"model":"gpt-5","stream":true,"reasoning":{"effort":"high"},"messages":[{"role":"user","content":"One sentence. No preamble."}]}' | head -n 10 || true
echo
echo "Proxy up at http://127.0.0.1:11435/v1"
