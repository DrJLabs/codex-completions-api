---
title: Codex Completions API — Product Requirements (PRD)
status: draft
version: v1
updated: 2025-09-14
---

# Overview

An OpenAI Chat Completions–compatible proxy for Codex CLI. It exposes `GET /v1/models` and `POST /v1/chat/completions` with optional streaming (SSE), plus a `GET /healthz` endpoint and a legacy shim for `POST /v1/completions`. The proxy normalizes model IDs and maps requests to a Codex process (`codex proto`).

# Users & Use Cases

- Developers and tools expecting OpenAI-compatible endpoints (IDEs, SDKs, curl).
- CI smoke/E2E tests verifying availability and streaming contract.

# Functional Requirements

- Models listing
  - Route: `GET,HEAD,OPTIONS /v1/models` (JSON list)
  - Advertises `codev-5*` in dev and `codex-5*` in prod; accepts both prefixes everywhere. Implemented in `src/routes/models.js` using `publicModelIds()` from `src/config/models.js`.
  - Gating: `PROXY_PROTECT_MODELS=true` requires Bearer auth (same key as chat).
- Chat Completions
  - Route: `POST /v1/chat/completions` (also supports `HEAD` and `OPTIONS` for contract/CORS checks)
  - Auth: Bearer required (`Authorization: Bearer <PROXY_API_KEY>`).
  - Non‑stream (JSON): returns OpenAI‑shaped payload with `choices[0].message.content` and `usage`.
  - Stream (SSE): `Content-Type: text/event-stream` with role‑first delta chunks and terminating `[DONE]`.
  - Model resolution: accepts env‑appropriate advertised IDs, also `gpt-5` with optional `reasoning.effort`.
  - Tool‑related options (opt‑in): tail suppression or cut‑after‑tools to support strict tool‑first clients.
- Legacy Completions Shim
  - Route: `POST /v1/completions` (maps to Chat backend). Same auth and model rules.
- Health
  - Route: `GET /healthz` returns `{ ok: true, sandbox_mode }`.

# Non‑Functional Requirements

- CORS: Enabled by default (`PROXY_ENABLE_CORS`, preflight handled globally).
- Stability: Respect timeouts (`PROXY_TIMEOUT_MS`, `PROXY_IDLE_TIMEOUT_MS`, `PROXY_STREAM_IDLE_TIMEOUT_MS`).
- Streaming: Keepalives every `PROXY_SSE_KEEPALIVE_MS` ms; can be disabled via `User‑Agent` (Electron/Obsidian), `X-No-Keepalive: 1`, or `?no_keepalive=1`.
- Security: Single bearer key (`PROXY_API_KEY`) for all protected routes.
- Observability: Text access log plus structured JSON access log (`src/middleware/access-log.js`); dev‑mode proto/tool logs gated by env.
- Sandbox/Workdir: Child process runs with `CODEX_HOME` and `PROXY_CODEX_WORKDIR` set.
- Rate limiting: In‑process token bucket (`src/middleware/rate-limit.js`), intended as defense‑in‑depth; rely on edge for primary RL.

## Business Goals & KPIs (SLIs/SLOs)

Purpose: quantify success and guard reliability for the proxy. These targets are initial and should be tuned with production data.

- Availability SLO: 99.9% monthly (excludes planned maintenance).
- Non‑stream response p95: ≤ 5 s for short prompts (≤ 512 tokens joined).
- Stream TTFC p95: ≤ 2 s; stream remains active with keepalives ≤ `PROXY_SSE_KEEPALIVE_MS`.
- Error budget: 5xx rate < 1% of requests (auth errors excluded).
- Concurrency envelope per replica: ≤ `PROXY_SSE_MAX_CONCURRENCY` active streams; ensure `ulimit -n` allows ≥ 32 × concurrency.
- Edge health: Successful `GET /v1/models` and `POST /v1/chat/completions` (non‑stream) via edge smoke after each deploy.

Measurement notes
- Use structured access logs for p95 latency approximations (`dur_ms` field) and error rates; aggregate with your log pipeline.
- For TTFC, use Playwright E2E or client metrics; optional lightweight server metric can be added later.
- Maintain an incident log referencing the Operational Runbook.

# Configuration (Key Env Vars)

- `PORT` (default 11435)
- `PROXY_API_KEY` (required for protected routes)
- `PROXY_ENV` (`dev` → advertise `codev-5*`; otherwise `codex-5*`)
- `PROXY_PROTECT_MODELS` (`true` to require auth for `/v1/models`)
- `CODEX_MODEL` default model name; accepts `gpt-5`
- `CODEX_BIN` path or name of Codex binary; `CODEX_HOME` for Codex runtime home
- `PROXY_SANDBOX_MODE` (default `danger-full-access`)
- `PROXY_CODEX_WORKDIR` working directory for child process
- Streaming & tools behavior: `PROXY_STOP_AFTER_TOOLS` (boolean), `PROXY_STOP_AFTER_TOOLS_MODE` (`burst`|`first`), `PROXY_STOP_AFTER_TOOLS_GRACE_MS` (cut delay), `PROXY_TOOL_BLOCK_MAX` (max <use_tool> blocks before cut), `PROXY_SUPPRESS_TAIL_AFTER_TOOLS` (boolean)
- Timeouts: `PROXY_TIMEOUT_MS`, `PROXY_IDLE_TIMEOUT_MS`, `PROXY_STREAM_IDLE_TIMEOUT_MS`, `PROXY_PROTO_IDLE_MS`
- `PROXY_SSE_KEEPALIVE_MS`, `PROXY_KILL_ON_DISCONNECT`, `PROXY_DEBUG_PROTO`
- Rate limiting: `PROXY_RATE_LIMIT_ENABLED` (boolean), `PROXY_RATE_LIMIT_WINDOW_MS`, `PROXY_RATE_LIMIT_MAX`
- Concurrency: `PROXY_SSE_MAX_CONCURRENCY` (limit concurrent streams; 0 disables)

# API Details

## GET /healthz

- 200 with `{ ok: true, sandbox_mode }`.

## GET /v1/models

- 200 with list of advertised models. 401 with `WWW-Authenticate` when `PROXY_PROTECT_MODELS=true` and missing/invalid key.
- `HEAD` and `OPTIONS` supported.

## POST /v1/chat/completions

- Body (minimal): `{ "model": "gpt-5" | "codex-5-low" | "codev-5-low", "messages": [{"role":"user","content":"..."}], "stream": boolean }`
- Auth: `Authorization: Bearer <PROXY_API_KEY>` required.
- Non‑stream returns JSON with `choices[0].message.content` and `usage`.
- Stream returns SSE events and final `data: [DONE]`. Stable `id` and `created` across all chunks; per‑chunk envelope includes `id/object/created/model`.

## POST /v1/completions (shim)

- Body: `{ "model": "...", "prompt": "...", "stream": boolean }` → mapped to chat backend.
- `HEAD` and `OPTIONS` are supported.

## Error Responses (Examples)

- 401 Unauthorized

```json
{
  "error": {
    "message": "unauthorized",
    "type": "authentication_error",
    "code": "invalid_api_key"
  }
}
```

- 404 model_not_found (invalid `model`)

```json
{
  "error": {
    "message": "The model codex-9 does not exist or you do not have access to it.",
    "type": "invalid_request_error",
    "param": "model",
    "code": "model_not_found"
  }
}
```

## Error Envelope Policy

- All error responses follow this shape: `{ "error": { "message": string, "type": string, "param"?: string, "code"?: string } }`.
- Authentication failures include `WWW-Authenticate` header and `code: "invalid_api_key"`.

## Success Examples (Representative)

GET /v1/models

```json
{
  "object": "list",
  "data": [{ "id": "codex-5-low", "object": "model", "owned_by": "codex", "created": 0 }]
}
```

Note: In dev, IDs are `codev-5*`; response structure is identical.

POST /v1/chat/completions (non‑stream)

```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1726032000,
  "model": "gpt-5",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "Hello!" },
      "finish_reason": "stop"
    }
  ],
  "usage": { "prompt_tokens": 12, "completion_tokens": 4, "total_tokens": 16 }
}
```

# Smoke Tests

Export these first (local dev):

```bash
BASE="http://127.0.0.1:11435"
KEY="codex-local-secret"   # or your PROXY_API_KEY
```

Health

```bash
curl -s "$BASE/healthz" | jq .
```

Models (unauth; add -H Authorization if PROXY_PROTECT_MODELS=true)

```bash
curl -s "$BASE/v1/models" | jq .
curl -sI "$BASE/v1/models"   # HEAD
```

Chat (non‑stream)

```bash
curl -s "$BASE/v1/chat/completions" \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"model":"gpt-5","stream":false,"messages":[{"role":"user","content":"Say hello."}]}' | jq '.choices[0].message.content'
```

Chat (stream)

```bash
curl -N "$BASE/v1/chat/completions" \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"model":"gpt-5","stream":true,"messages":[{"role":"user","content":"Count to 3"}]}'
```

Completions shim (non‑stream)

```bash
curl -s "$BASE/v1/completions" \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"model":"gpt-5","stream":false,"prompt":"Say hello."}' | jq '.choices[0].text'
```

# Acceptance Criteria

- Health, models, non‑stream chat, and stream chat smoke commands succeed with 2xx.
- SSE stream includes chunks and ends with `[DONE]`.
- Missing/invalid bearer returns 401 with `WWW-Authenticate`.

# CORS & Origins

- Default: `PROXY_ENABLE_CORS=true` enables permissive CORS with preflight handling.
- Recommendation (prod behind Traefik/Cloudflare): prefer restricting CORS at the edge and set `PROXY_ENABLE_CORS=false` unless browser clients require it.

# SLIs / SLOs (Initial Targets)

- Non‑stream p95 time‑to‑response (short prompt): ≤ 5s.
- Stream p95 time‑to‑first‑chunk: ≤ 2s; idle lulls ≤ `PROXY_STREAM_IDLE_TIMEOUT_MS` (5m default).
- 5xx rate: < 1% during normal operation; auth errors excluded.

# API Versioning & Compatibility

- Follows OpenAI‑compatible shapes for models and chat (non‑stream/stream).
- Changes are additive whenever possible. Any breaking change to response schema or headers is treated as a major revision and documented in CHANGELOG.

# Scaling & Availability

- The proxy is stateless; scale horizontally behind Traefik/Cloudflare without sticky sessions.
- Long‑lived SSE connections: budget connections per replica; tune `PROXY_SSE_KEEPALIVE_MS` and idle timeouts to match ingress timeouts.
- Ensure sufficient file descriptors (`ulimit -n`) for concurrent SSE clients.

## Environment Profiles (Dev vs Prod)

Recommended defaults per environment. Adjust as traffic and client mix evolve.

| Setting | Dev (local/dev stack) | Prod |
| --- | --- | --- |
| `PROXY_ENV` | `dev` | `""` (non‑dev) |
| Advertised models | `codev-5*` | `codex-5*` |
| `PROXY_ENABLE_CORS` | `true` | `true` (or restrict at edge) |
| `PROXY_PROTECT_MODELS` | `false` | `true` |
| `PROXY_RATE_LIMIT_ENABLED` | `false` | `true` (window 60s, max 60 as baseline) |
| `PROXY_RATE_LIMIT_WINDOW_MS` | `60000` | `60000` |
| `PROXY_RATE_LIMIT_MAX` | `60` | `60` (tune with edge RL) |
| `PROXY_SSE_KEEPALIVE_MS` | `15000` | `15000` (tune with ingress/edge timeouts) |
| `PROXY_SSE_MAX_CONCURRENCY` | `4` | `16` (start small; scale replicas) |
| `PROXY_KILL_ON_DISCONNECT` | `false` | `true` |
| `PROXY_STOP_AFTER_TOOLS` | `false` | `false` (enable only for tool‑strict clients) |
| `PROXY_SUPPRESS_TAIL_AFTER_TOOLS` | `false` | `false` (enable per client need) |
| `PROXY_STOP_AFTER_TOOLS_MODE` | `burst` | `burst` |
| `PROXY_STOP_AFTER_TOOLS_GRACE_MS` | `300` | `300` |
| `PROXY_TOOL_BLOCK_MAX` | `0` | `0` (cap only if needed) |
| `CODEX_HOME` | `.codev/` | `.codex-api/` (writable) |
| `PROXY_CODEX_WORKDIR` | `/tmp/codex-work` | `/tmp/codex-work` |

Notes
- Prefer rate limiting and strict CORS at the edge (Traefik/Cloudflare); keep origin permissive only when browser clients call it directly.
- Keep `.codex-api/` writable in prod for rollout/session persistence.
- After any compose/label change: rebuild with force‑recreate and run `npm run smoke:prod`.

# Out of Scope (for now)

- Files, images, and audio routes.
- Fine‑tuning APIs.

# References

- `server.js`
- `docker-compose.yml`
- `auth/server.mjs` (ForwardAuth)
- `README.md`
- `src/config/models.js`
- `src/routes/chat.js`, `src/handlers/chat/*`
- `src/middleware/access-log.js`, `src/middleware/rate-limit.js`
- Operational Runbook: `docs/runbooks/operational.md`
