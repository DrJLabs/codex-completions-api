/* eslint-disable security/detect-object-injection */
import os from "node:os";
import path from "node:path";
const str = (name, def) => String(process.env[name] ?? def);
const num = (name, def) => {
  const raw = process.env[name];
  const val = Number(raw);
  return Number.isNaN(val) ? Number(def) : val;
};
const bool = (name, def) => String(process.env[name] ?? def).toLowerCase() === "true";

export const config = {
  PORT: num("PORT", 11435),
  API_KEY: str("PROXY_API_KEY", "codex-local-secret"),
  PROXY_ENV: str("PROXY_ENV", ""),
  PROTECT_MODELS: bool("PROXY_PROTECT_MODELS", "false"),
  CODEX_MODEL: str("CODEX_MODEL", "gpt-5"),
  CODEX_BIN: str("CODEX_BIN", "codex"),
  CODEX_HOME: str("CODEX_HOME", path.join(process.cwd(), ".codex-api")),
  PROXY_SANDBOX_MODE: str("PROXY_SANDBOX_MODE", "danger-full-access").toLowerCase(),
  PROXY_CODEX_WORKDIR: str("PROXY_CODEX_WORKDIR", path.join(os.tmpdir(), "codex-work")),
  CODEX_FORCE_PROVIDER: str("CODEX_FORCE_PROVIDER", ""),
  // Streaming & tools controls
  PROXY_SSE_KEEPALIVE_MS: num("PROXY_SSE_KEEPALIVE_MS", 15000),
  PROXY_STOP_AFTER_TOOLS: bool("PROXY_STOP_AFTER_TOOLS", ""),
  PROXY_STOP_AFTER_TOOLS_MODE: str("PROXY_STOP_AFTER_TOOLS_MODE", "burst").toLowerCase(),
  PROXY_SUPPRESS_TAIL_AFTER_TOOLS: bool("PROXY_SUPPRESS_TAIL_AFTER_TOOLS", ""),
  PROXY_TOOL_BLOCK_DEDUP: bool("PROXY_TOOL_BLOCK_DEDUP", ""),
  PROXY_TOOL_BLOCK_DELIMITER: bool("PROXY_TOOL_BLOCK_DELIMITER", ""),
  // Timeouts
  PROXY_TIMEOUT_MS: num("PROXY_TIMEOUT_MS", 300000),
  PROXY_IDLE_TIMEOUT_MS: num("PROXY_IDLE_TIMEOUT_MS", 15000),
  PROXY_STREAM_IDLE_TIMEOUT_MS: num("PROXY_STREAM_IDLE_TIMEOUT_MS", 300000),
  PROXY_PROTO_IDLE_MS: num("PROXY_PROTO_IDLE_MS", 120000),
  // Misc
  PROXY_ENABLE_CORS: str("PROXY_ENABLE_CORS", "true"),
  PROXY_KILL_ON_DISCONNECT: str("PROXY_KILL_ON_DISCONNECT", "false"),
  PROXY_DEBUG_PROTO: str("PROXY_DEBUG_PROTO", ""),
};
