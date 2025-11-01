/* eslint-disable security/detect-object-injection */
import os from "node:os";
import path from "node:path";
const str = (name, def) => String(process.env[name] ?? def);
const num = (name, def) => {
  const raw = process.env[name];
  const val = Number(raw);
  return Number.isNaN(val) ? Number(def) : val;
};
const resolveTruncateMs = () => {
  const modern = process.env.PROXY_NONSTREAM_TRUNCATE_AFTER_MS;
  if (modern !== undefined && modern !== "") {
    const parsedModern = Number(modern);
    if (!Number.isNaN(parsedModern)) return parsedModern;
  }

  const legacy = process.env.PROXY_DEV_TRUNCATE_AFTER_MS;
  if (legacy !== undefined && legacy !== "") {
    const parsedLegacy = Number(legacy);
    if (!Number.isNaN(parsedLegacy)) return parsedLegacy;
  }

  return 0;
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
  PROXY_USE_APP_SERVER: bool("PROXY_USE_APP_SERVER", "false"),
  CODEX_FORCE_PROVIDER: str("CODEX_FORCE_PROVIDER", ""),
  // Streaming & tools controls
  PROXY_SSE_KEEPALIVE_MS: num("PROXY_SSE_KEEPALIVE_MS", 15000),
  PROXY_ENABLE_PARALLEL_TOOL_CALLS: bool("PROXY_ENABLE_PARALLEL_TOOL_CALLS", "false"),
  PROXY_STOP_AFTER_TOOLS: bool("PROXY_STOP_AFTER_TOOLS", ""),
  PROXY_STOP_AFTER_TOOLS_MODE: str("PROXY_STOP_AFTER_TOOLS_MODE", "burst").toLowerCase(),
  PROXY_SUPPRESS_TAIL_AFTER_TOOLS: bool("PROXY_SUPPRESS_TAIL_AFTER_TOOLS", ""),
  // Timeouts
  PROXY_TIMEOUT_MS: num("PROXY_TIMEOUT_MS", 300000),
  PROXY_IDLE_TIMEOUT_MS: num("PROXY_IDLE_TIMEOUT_MS", 15000),
  PROXY_STREAM_IDLE_TIMEOUT_MS: num("PROXY_STREAM_IDLE_TIMEOUT_MS", 300000),
  PROXY_PROTO_IDLE_MS: num("PROXY_PROTO_IDLE_MS", 120000),
  // Misc
  PROXY_ENABLE_CORS: str("PROXY_ENABLE_CORS", "true"),
  PROXY_CORS_ALLOWED_ORIGINS: str("PROXY_CORS_ALLOWED_ORIGINS", "*"),
  PROXY_LOG_CORS_ORIGIN: bool("PROXY_LOG_CORS_ORIGIN", "false"),
  PROXY_KILL_ON_DISCONNECT: str("PROXY_KILL_ON_DISCONNECT", "false"),
  PROXY_DEBUG_PROTO: str("PROXY_DEBUG_PROTO", ""),
  PROXY_SANITIZE_METADATA: bool("PROXY_SANITIZE_METADATA", "false"),
  // Worker supervisor
  WORKER_BACKOFF_INITIAL_MS: num("WORKER_BACKOFF_INITIAL_MS", 500),
  WORKER_BACKOFF_MAX_MS: num("WORKER_BACKOFF_MAX_MS", 5000),
  WORKER_RESTART_MAX: num("WORKER_RESTART_MAX", 25),
  WORKER_STARTUP_TIMEOUT_MS: num("WORKER_STARTUP_TIMEOUT_MS", 8000),
  WORKER_SHUTDOWN_GRACE_MS: num("WORKER_SHUTDOWN_GRACE_MS", 5000),
  WORKER_MAX_CONCURRENCY: num("WORKER_MAX_CONCURRENCY", 4),
  WORKER_REQUEST_TIMEOUT_MS: num("WORKER_REQUEST_TIMEOUT_MS", 120000),
  WORKER_HANDSHAKE_TIMEOUT_MS: num("WORKER_HANDSHAKE_TIMEOUT_MS", 15000),
  // Security
  PROXY_RATE_LIMIT_ENABLED: bool("PROXY_RATE_LIMIT_ENABLED", "false"),
  PROXY_RATE_LIMIT_WINDOW_MS: num("PROXY_RATE_LIMIT_WINDOW_MS", 60_000),
  PROXY_RATE_LIMIT_MAX: num("PROXY_RATE_LIMIT_MAX", 60),
  PROXY_SSE_MAX_CONCURRENCY: num("PROXY_SSE_MAX_CONCURRENCY", 4),
  PROXY_TEST_ENDPOINTS: bool("PROXY_TEST_ENDPOINTS", "false"),
  // Non-stream guard: allow early finalize to avoid edge timeouts (ms; 0=disabled)
  PROXY_NONSTREAM_TRUNCATE_AFTER_MS: resolveTruncateMs(),
  // Back-compat alias (deprecated name, maps to the same value)
  PROXY_DEV_TRUNCATE_AFTER_MS: resolveTruncateMs(),
  // Limits
  PROXY_MAX_PROMPT_TOKENS: num("PROXY_MAX_PROMPT_TOKENS", 0), // 0 disables context-length guard
  PROXY_MAX_CHAT_CHOICES: num("PROXY_MAX_CHAT_CHOICES", 5),
};
