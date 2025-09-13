---
title: Tech Stack — Codex Completions API
status: draft
version: v1
updated: 2025-09-13
---

# Runtime & Language

- Node.js: >= 22 (ESM only). See `package.json:81` and local `node -v` in dev.
- Platform: Linux container (Docker) and host (for Traefik ForwardAuth).
- Primary language: JavaScript (ES2023).

# Frameworks & Libraries

- Web framework: `express@^4.19` — routing and middleware.
- Utilities: `nanoid@^5` — request/stream IDs.
- Child process: Node `child_process.spawn` via `src/services/codex-runner.js`.
- Streaming: Server‑Sent Events (SSE) utilities in `src/services/sse.js`.

# External Dependency

- Codex CLI binary (`CODEX_BIN`, default `codex`) invoked as `codex proto ...` with configuration flags for model/provider/sandbox. Home/state in `CODEX_HOME` (dev: `.codev/`, prod: `.codex-api/`), workdir in `PROXY_CODEX_WORKDIR`.

# Authentication & Security

- Bearer token on chat/completions routes; optional gating for `/v1/models`.
- Traefik ForwardAuth microservice (`auth/server.mjs`) validates `Authorization: Bearer` upstream in PROD.
- CORS enabled by default globally; OPTIONS handled centrally.
- Optional in‑app rate limiting: token‑bucket per API key/IP.

# Configuration Surface (selected)

- Core: `PORT`, `PROXY_ENV`, `PROXY_API_KEY`, `PROXY_PROTECT_MODELS`.
- Codex: `CODEX_BIN`, `CODEX_HOME`, `CODEX_MODEL`, `CODEX_FORCE_PROVIDER`, `PROXY_CODEX_WORKDIR`.
- Streaming/SSE: `PROXY_SSE_KEEPALIVE_MS`, `PROXY_SSE_MAX_CONCURRENCY`, `PROXY_KILL_ON_DISCONNECT`.
- Tool‑heavy clients: `PROXY_STOP_AFTER_TOOLS`, `PROXY_STOP_AFTER_TOOLS_MODE`, `PROXY_SUPPRESS_TAIL_AFTER_TOOLS`, `PROXY_TOOL_BLOCK_MAX`, `PROXY_STOP_AFTER_TOOLS_GRACE_MS`.
- Timeouts: `PROXY_TIMEOUT_MS`, `PROXY_IDLE_TIMEOUT_MS`, `PROXY_STREAM_IDLE_TIMEOUT_MS`, `PROXY_PROTO_IDLE_MS`.
- Rate limit: `PROXY_RATE_LIMIT_ENABLED`, `PROXY_RATE_LIMIT_WINDOW_MS`, `PROXY_RATE_LIMIT_MAX`.
- CORS/Debug: `PROXY_ENABLE_CORS`, `PROXY_DEBUG_PROTO`, `PROXY_TEST_ENDPOINTS`.

# Testing & QA

- Unit & Integration: `vitest@^3` (+ `@vitest/coverage-v8`).
- E2E/API/SSE: `@playwright/test@^1.55`.
- Coverage target configured in `vitest.config.ts` (V8 engine).

# Linting & Formatting

- ESLint 9 (flat config) with plugins: import, n, promise, security; Prettier 3 for formatting.
- `npm run verify:all` runs format check, lint, unit, integration, and E2E.

# Build & Packaging

- Dockerfile: builds app image.
- Production compose: `docker-compose.yml` (source of truth for Traefik labels and networks).
- Dev stack: `compose.dev.stack.yml` with Traefik on host, app container, and ForwardAuth.
- Systemd unit: `systemd/codex-openai-proxy.service` for host‑level management.

# Ingress & Edge

- Traefik (host/system service) with ForwardAuth target `http://127.0.0.1:18080/verify`.
- Cloudflare as public edge (DNS/SSL); routes forward to Traefik origin.

# Logging & Observability

- Structured JSON access logs (`src/middleware/access-log.js`) to stdout.
- Usage and proto event NDJSON in temp dir (`src/dev-logging.js`); aggregated via `/v1/usage`.
- No builtin Prometheus metrics; rely on logs/edge metrics.

# Model IDs

- DEV advertises `codev-5{,-low,-medium,-high,-minimal}`; PROD advertises `codex-5{,…}`; both prefixes accepted everywhere, normalized to runtime `CODEX_MODEL`.

# Operational Notes

- `.codex-api/` MUST be writable in production; do not mount read‑only.
- Long‑lived SSE: budget file descriptors and timeouts accordingly; consider replica scaling and `PROXY_SSE_MAX_CONCURRENCY` for backpressure.
