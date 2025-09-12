---
title: Codex Completions API — Architecture
status: draft
version: v1
updated: 2025-09-11
---

# Context

Node/Express service that presents OpenAI‑compatible endpoints and forwards work to Codex CLI. Designed for dev/prod parity with Traefik ForwardAuth, Cloudflare edge, and simple container packaging.

# System Overview

- Entry points
  - `GET /healthz` — liveness and sandbox mode
  - `GET,HEAD,OPTIONS /v1/models` — advertised models (auth optional via `PROXY_PROTECT_MODELS`)
  - `POST /v1/chat/completions` — chat (stream and non‑stream)
  - `POST /v1/completions` — legacy shim mapping to chat
- Child process: spawns Codex (`codex proto ...`) with normalized model + reasoning effort, isolated via `CODEX_HOME` and working in `PROXY_CODEX_WORKDIR`.
- CORS: enabled by default and handled globally for all methods including OPTIONS.

# Request Lifecycle (Non‑stream)

1. Express parses JSON and enforces Bearer auth (chat/completions).
2. Model normalization (`normalizeModel`) resolves requested vs effective model.
3. Spawns `codex proto` with configs (sandbox mode, model, optional provider, effort).
4. Aggregates output; optional tool‑block handling (dedup/suppress tail) applied.
5. Returns OpenAI‑shaped response with `usage`.

# Request Lifecycle (Stream SSE)

1. Sets headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`.
2. Emits role‑first deltas; stable `id` across chunks; ends with `data: [DONE]`.
3. Keepalive comments every `PROXY_SSE_KEEPALIVE_MS` unless disabled by UA/header/query.
4. Optional early cut after tool blocks (if `PROXY_STOP_AFTER_TOOLS=true`).
5. Cleanup on `close/finish/aborted`; optional `PROXY_KILL_ON_DISCONNECT` terminates child.

# Components

- `server.js`
  - CORS + access logging
  - Models router (auth‑optional), health, chat/completions (stream + non‑stream)
  - SSE framing and keepalive logic
  - Env handling: timeouts, sandbox, model/provider, tool‑block options
- `auth/server.mjs` (ForwardAuth)
  - Validates `Authorization: Bearer <PROXY_API_KEY>`
  - CORS for preflight; `/healthz` passthrough; `WWW‑Authenticate` on 401
- Container/Ingress
  - `docker-compose.yml` w/ Traefik labels; service attaches to external `traefik` network
  - ForwardAuth target (prod): `http://127.0.0.1:18080/verify`

# Compatibility Shapes (selected)

- Models: `{ object: "list", data: [{ id, object: "model", owned_by, created }] }`
- Chat non‑stream: `{ object: "chat.completion", choices: [{ message: { role, content }, finish_reason }], usage }`
- Chat stream: `{ object: "chat.completion.chunk", choices: [{ index: 0, delta: { role? | content? } }] }` with final `data: [DONE]`
- Completions shim: `text_completion` / `text_completion.chunk` (mapped to chat backend)

# Configuration Surface (selected)

- Core: `PORT`, `PROXY_API_KEY`, `PROXY_ENV`, `PROXY_PROTECT_MODELS`
- Codex: `CODEX_BIN`, `CODEX_HOME` (default `.codex-api/`), `CODEX_MODEL`, `CODEX_FORCE_PROVIDER`
- Sandbox: `PROXY_SANDBOX_MODE` (default `danger-full-access`), `PROXY_CODEX_WORKDIR`
- Streaming/tool behavior: `PROXY_SSE_KEEPALIVE_MS`, `PROXY_STOP_AFTER_TOOLS{,_MODE}`, `PROXY_SUPPRESS_TAIL_AFTER_TOOLS`, `PROXY_TOOL_BLOCK_{DEDUP,DELIMITER}`
- Timeouts: `PROXY_TIMEOUT_MS`, `PROXY_IDLE_TIMEOUT_MS`, `PROXY_STREAM_IDLE_TIMEOUT_MS`, `PROXY_PROTO_IDLE_MS`
- Diagnostics: `PROXY_DEBUG_PROTO`, minimal dev logs around prompts, usage, and tool blocks

# Deployment Modes

- Dev (local Node or dev stack compose): advertises `codev-5*` but accepts both prefixes; `.codev/` as Codex HOME.
- Prod (compose + Traefik + Cloudflare): advertises `codex-5*`; `.codex-api/` writable; ForwardAuth on loopback.

# Security Model

- Single bearer key across protected routes; models route optionally gated.
- ForwardAuth protects the edge in production; app still validates bearer on chat routes.

# Rate Limiting & Edge Controls

- Recommend enforcing request rate/connection limits at Traefik and/or Cloudflare.
- Optional app‑level guard can be added later; none is built‑in today.

# Scaling Guidance

- Stateless service; run multiple replicas behind Traefik without sticky sessions.
- SSE is long‑lived: provision FD limits (`ulimit -n`) and connection budgets per replica.
- Align ingress/proxy timeouts with `PROXY_TIMEOUT_MS` and `PROXY_STREAM_IDLE_TIMEOUT_MS` to avoid premature disconnects.
- For Kubernetes, set readiness/liveness probes on `/healthz` and resource requests sized for Codex child process bursts.

# Observability

- Access log line per request; stream/non‑stream dev logs gated by env flags.
- Optional usage aggregation and proto events in `.server.log` (see `src/dev-logging.js`).

## Logging

- Prefer structured JSON logs with fields: `ts`, `req_id`, `method`, `route`, `status`, `dur_ms`, `ua`, and auth presence.
- Generate a stable `req_id` for correlation across logs and child process events.
- Set `X-Request-Id` response header to the same `req_id` for client-side correlation.
- Keep logs concise at info level; include debug streams only when `PROXY_DEBUG_PROTO` is enabled.

# Diagrams

- `docs/architecture.svg`
- `docs/request-flow.svg`

## Limits

- JSON body size: `express.json({ limit: "16mb" })`.
- Streaming idle timeout: `PROXY_STREAM_IDLE_TIMEOUT_MS` (default 5 minutes).
- Overall request timeout: `PROXY_TIMEOUT_MS` (default 5 minutes for non‑stream).
- SSE keepalive interval: `PROXY_SSE_KEEPALIVE_MS` (default 15s; can be disabled via UA/header/query).

## Metrics (Optional)

- Track at edge or sidecar: request count, p50/p95 latency (non‑stream), time‑to‑first‑chunk (stream), open SSE connections, error rates by class.
- Expose simple counters via logs or integrate with existing metrics pipeline; the app does not emit Prometheus metrics by default.

## Mini Runbook

- 401 on chat/completions: validate `Authorization: Bearer <PROXY_API_KEY>` and server env; ForwardAuth will also 401 at edge.
- 404 model_not_found: use advertised IDs from `/v1/models` or `gpt-5` with `reasoning.effort`.
- SSE stalls/clients drop: tune `PROXY_SSE_KEEPALIVE_MS`; disable keepalive for Electron/Obsidian via `X-No-Keepalive: 1` or `?no_keepalive=1`.
- 502/timeouts: check container health and logs; confirm ForwardAuth target `http://127.0.0.1:18080/verify`; verify service is on external `traefik` network.
- CORS preflight fails: set `PROXY_ENABLE_CORS=true` or configure CORS at Traefik; confirm `OPTIONS` paths respond 200.
