---
title: Codex Completions API — Architecture
status: draft
version: v2
updated: 2025-09-13
---

# Context

Node/Express service exposing OpenAI‑compatible endpoints and brokering requests to Codex CLI. The service was recently modularized and gained expanded tests, structured access logs, optional in‑app rate limiting, richer SSE controls, and usage/proto event logging.

# System Overview

- Entry points
  - `GET /healthz` — liveness + sandbox mode (src/routes/health.js:6)
  - `GET|HEAD /v1/models` — advertised IDs; gated when `PROXY_PROTECT_MODELS=true` (src/routes/models.js:38,45,26–36)
  - `POST /v1/chat/completions` — chat; stream and non‑stream (src/routes/chat.js:16–20)
  - `POST /v1/completions` — legacy shim to the same handlers (src/routes/chat.js:22–26)
  - `GET /v1/usage` and `GET /v1/usage/raw` — dev usage aggregation + raw events (src/routes/usage.js:31,40)
- Child process per request: `codex proto ...` with normalized model + optional provider + reasoning effort (src/handlers/chat/shared.js:8–28; src/services/codex-runner.js:16–35).
- CORS: applied globally for all methods including OPTIONS (src/app.js:15–24; src/utils.js:140–189).

# Module Boundaries

- Bootstrap
  - `server.js` — thin HTTP wrapper (listen + signals). App construction moved out. (server.js:4–10,12–22)
  - `src/app.js` — JSON body limit, global CORS, access logging, rate limit middleware, router mounts. (src/app.js:11–13,15–24,26–44,45–66)
- Routers
  - Health (src/routes/health.js:4–9)
  - Models (src/routes/models.js:7–24,38–52)
  - Chat + legacy completions (src/routes/chat.js:1–26)
  - Usage (src/routes/usage.js:28–49)
- Handlers
  - Chat non‑stream (src/handlers/chat/nonstream.js)
  - Chat stream (SSE) + legacy completions stream (src/handlers/chat/stream.js)
  - Shared proto arg builder (src/handlers/chat/shared.js)
- Services
  - Codex runner (spawn/env/workdir) (src/services/codex-runner.js)
  - SSE helpers (headers/keepalives/finish) (src/services/sse.js)
- Middleware
  - Access log (structured JSON, adds `X-Request-Id`) (src/middleware/access-log.js)
  - Token‑bucket rate limit for POST chat/completions (optional) (src/middleware/rate-limit.js)
- Config & Lib
  - Env config (src/config/index.js)
  - Model ID helpers (src/config/models.js)
  - Errors (src/lib/errors.js)
  - Utils (token est., join, CORS, model normalization) (src/utils.js)
- ForwardAuth sidecar
  - `auth/server.mjs` — Traefik ForwardAuth; validates bearer and handles CORS (`/verify`, `/healthz`).

# Request Lifecycles

## Chat — Non‑stream

1. JSON body + auth validated (src/handlers/chat/nonstream.js:41–46,48–60).
2. Normalize model; reject unknown requested IDs (src/handlers/chat/nonstream.js:62–75; src/config/models.js:8–12; src/utils.js:116–138).
3. Build `codex proto` args (sandbox, model, optional provider, effort) (src/handlers/chat/nonstream.js:91–97; shared.js:8–28).
4. Consume child events, accumulate content and token counts; idle guard (src/handlers/chat/nonstream.js:160–206,141–156).
5. Return OpenAI‑shaped JSON with `usage` (src/handlers/chat/nonstream.js:28–41).

## Chat — Stream (SSE)

1. Auth + validation; per‑process SSE concurrency guard via `PROXY_SSE_MAX_CONCURRENCY` (src/handlers/chat/stream.js:55–63,108–122).
2. Set SSE headers (`text/event-stream`, `X-Accel-Buffering: no`), compute keepalive interval with UA/header/query overrides (src/services/sse.js:5–19,21–39; src/handlers/chat/stream.js:223–259).
3. Emit role‑first delta, then content deltas; stable `id` per completion; final `[DONE]` (src/handlers/chat/stream.js:203–214,223–259,254–259; 174–210 on completion).
4. Optional shaping: tail suppression and early‑cut after `<use_tool>` blocks via `PROXY_SUPPRESS_TAIL_AFTER_TOOLS` and `PROXY_STOP_AFTER_TOOLS{,_MODE,_GRACE_MS}`; optional `PROXY_TOOL_BLOCK_MAX` cap (src/handlers/chat/stream.js:73–109,84–109; 95–109 for cut path).
5. Cleanup on `close/finish/aborted`; optional child kill on disconnect via `PROXY_KILL_ON_DISCONNECT` (src/handlers/chat/stream.js:237–259,1–3,246–251).

## Legacy Completions

Mirrors chat behavior for both non‑stream and stream, mapping prompt↔messages while preserving OpenAI shapes (src/handlers/chat/nonstream.js:59–257; src/handlers/chat/stream.js:261–382).

# Security Model

- Bearer key required for chat/completions; models route optionally gated via `PROXY_PROTECT_MODELS` (src/routes/models.js:26–36; src/handlers/*: token checks near the top of each handler).
- ForwardAuth (Traefik) service validates bearer before requests reach app in PROD (auth/server.mjs:33–54).
- CORS defaults enabled globally; preflight handled centrally (src/app.js:15–24; src/utils.js:140–189; auth/server.mjs:39–42 for sidecar).

# Rate Limiting

- In‑app token bucket (optional): `PROXY_RATE_LIMIT_ENABLED=true` gates POST `/v1/chat/completions` and `/v1/completions` per API key (fallback IP). Window and max via `PROXY_RATE_LIMIT_WINDOW_MS` and `PROXY_RATE_LIMIT_MAX`. Periodic bucket cleanup prevents growth (src/middleware/rate-limit.js:6–24,26–54).
- Edge limits recommended at Traefik/Cloudflare for defense‑in‑depth.

# Model IDs & Normalization

- Advertised IDs depend on env: DEV → `codev-5{,-low,-medium,-high,-minimal}`; PROD → `codex-5{,…}` (src/config/models.js:3–6).
- Accepted IDs include both DEV/PROD prefixes plus fallback default (`gpt-5`) for effective model (src/config/models.js:8–12).
- `normalizeModel` maps public IDs to the effective runtime model ID; unknown IDs are treated as exact (and rejected earlier for advertised lists) (src/utils.js:116–138).

# Observability

- Structured access logs: JSON line per request with `req_id`, route, status, latency, UA, auth presence (src/middleware/access-log.js:10–31). Minimal text line also retained (src/app.js:26–40).
- Usage logs: NDJSON at tmp path (default `${TMPDIR}/codex-usage.ndjson`) with token estimates and timing (src/dev-logging.js:9–29; used in handlers when responding).
- Proto event logs (DEV): NDJSON of child stdout/stderr/chunks and tool blocks (src/dev-logging.js:11–15,31–37). Aggregation endpoints in `/v1/usage*` (src/routes/usage.js).

# Configuration Surface

- Core/Env: see src/config/index.js:12–43
  - `PORT`, `PROXY_ENV`, `PROXY_API_KEY`, `PROXY_PROTECT_MODELS`
  - Codex: `CODEX_BIN`, `CODEX_HOME`, `CODEX_MODEL`, `CODEX_FORCE_PROVIDER`, `PROXY_CODEX_WORKDIR`
  - Streaming/Tools: `PROXY_SSE_KEEPALIVE_MS`, `PROXY_STOP_AFTER_TOOLS`, `PROXY_STOP_AFTER_TOOLS_MODE`, `PROXY_SUPPRESS_TAIL_AFTER_TOOLS`, `PROXY_SSE_MAX_CONCURRENCY`
  - Timeouts: `PROXY_TIMEOUT_MS`, `PROXY_IDLE_TIMEOUT_MS`, `PROXY_STREAM_IDLE_TIMEOUT_MS`, `PROXY_PROTO_IDLE_MS`
  - Security: `PROXY_RATE_LIMIT_ENABLED`, `PROXY_RATE_LIMIT_WINDOW_MS`, `PROXY_RATE_LIMIT_MAX`
  - Misc: `PROXY_KILL_ON_DISCONNECT`, `PROXY_ENABLE_CORS`, `PROXY_DEBUG_PROTO`, `PROXY_TEST_ENDPOINTS`

# Limits & Defaults

- JSON body limit: 16 MiB (src/app.js:13)
- SSE keepalive: 15 s default; disabled for Electron/Obsidian UAs or `X-No-Keepalive: 1`/`?no_keepalive=1` (src/services/sse.js:13–19)
- Stream idle timeout and overall timeouts configurable via env (src/config/index.js:29–33)

# Scaling & Resilience

- Stateless; safe to run multiple replicas behind Traefik without sticky sessions.
- Per‑process SSE concurrency guard avoids overload with `PROXY_SSE_MAX_CONCURRENCY`; consider pod replica scaling for sustained streams (src/handlers/chat/stream.js:61–66,108–122).
- Graceful shutdown hooks close the listener on SIGTERM/SIGINT (server.js:12–22).

# Tests & Coverage (high‑level)

- Unit (Vitest): utilities and dev logging (tests/unit/*.spec.js)
- Integration (Vitest): routes, headers, rate limit, idle/kill‑on‑disconnect, timeouts (tests/integration/*)
- E2E (Playwright): `/v1/models`, non‑stream chat, streaming SSE contract (tests/e2e/*; playwright.config.ts)

# Deployment Invariants (prod)

- `docker-compose.yml` is authoritative for routing/labels; service must be on external `traefik` network.
- Traefik ForwardAuth target (host loopback): `http://127.0.0.1:18080/verify` (auth/server.mjs serves it).
- `.codex-api/` MUST be writable in production; runtime workdir isolated under `PROXY_CODEX_WORKDIR`. See README for smoke commands.

# Diagrams & Cross‑Refs

- `docs/architecture.svg`, `docs/request-flow.svg`, `docs/architecture.png`
- See also: `docs/bmad/architecture/server-modularization-refactor.md`

# Mini Runbook

- 401 on chat/completions: check `Authorization: Bearer <PROXY_API_KEY>`; in PROD verify ForwardAuth env and service.
- 404 `model_not_found`: use `/v1/models` IDs or default `gpt-5` with optional `reasoning.effort`.
- SSE stalls/drops: tune `PROXY_SSE_KEEPALIVE_MS`; disable for Electron/Obsidian via `X-No-Keepalive: 1` or `?no_keepalive=1`.
- 429 rate limit: lower request burst or adjust `PROXY_RATE_LIMIT_*` or disable in-app limiter.
- Timeouts/502: confirm container health; verify Traefik labels/network and ForwardAuth target.
