# Codex Completions API — Brownfield Architecture Document

## Introduction

This document captures the current state of the Codex Completions API codebase (an OpenAI Chat Completions–compatible proxy that fronts a Codex CLI process), including real patterns, constraints, and known debt. It enables AI agents and humans to make safe, fast changes without re‑discovering context.

### Document Scope

Comprehensive documentation of the entire system (no PRD provided as of 2025-09-14).

### Change Log

| Date       | Version | Description                 | Author    |
| ---------- | ------- | --------------------------- | --------- |
| 2025-09-14 | 1.0     | Initial brownfield analysis | Architect |

## Quick Reference — Key Files and Entry Points

- Main entry: `server.js` (boots Express app from `src/app.js`)
- Config: `src/config/index.js` (all env flags), `src/config/models.js`
- Routers: `src/routes/health.js`, `src/routes/models.js`, `src/routes/chat.js`, `src/routes/usage.js`
- Handlers (chat): `src/handlers/chat/nonstream.js`, `src/handlers/chat/stream.js`, `src/handlers/chat/shared.js`
- Middleware: `src/middleware/rate-limit.js`, `src/middleware/access-log.js`
- Utilities: `src/utils.js`, `src/dev-logging.js`
- ForwardAuth (Traefik): `auth/server.mjs`
- Container/Orchestration: `docker-compose.yml`, `Dockerfile`, `compose.dev.stack.yml`
- Tests: `tests/**` (Vitest integration and Playwright E2E), `playwright.config.ts`
- Systemd unit example: `systemd/codex-openai-proxy.service`

If focusing streaming behavior or parity:
- SSE framing and headers: `src/handlers/chat/stream.js`
- Non‑stream response shape and usage accounting: `src/handlers/chat/nonstream.js`

## High Level Architecture

### Technical Summary

The service is a thin HTTP proxy that exposes OpenAI‑compatible endpoints under `/v1/*` and relays requests to a local Codex CLI (“proto”) child process. It shapes both non‑stream and SSE streaming responses to match OpenAI’s Chat Completions contract, adds CORS, optional model‑list gating, and a lightweight rate limiter. No database is used; state is in memory and in the Codex child process. Deployment targets Docker + Traefik (optionally fronted by Cloudflare). A minimal ForwardAuth service (`auth/server.mjs`) is provided for Traefik.

### Actual Tech Stack

| Category  | Technology          | Version/Notes                                      |
| --------- | ------------------- | -------------------------------------------------- |
| Runtime   | Node.js             | engines `>=22` (see `package.json`)                |
| Framework | Express             | 4.x                                                |
| Tests     | Vitest              | Unit/integration                                   |
| E2E       | Playwright Test     | SSE contract and CORS checks                       |
| Container | Docker, Compose     | Compose labels integrate with Traefik              |
| Infra     | Traefik, systemd    | ForwardAuth on `127.0.0.1:18080` in production     |

### Repository Structure Reality Check

- Type: single‑service Node project (no monorepo tooling)
- Package manager: npm (lockfile present)
- No DB layer; persistence is not in scope
- Public docs under `docs/`; CI and runtime scripts under `scripts/`

```text
project-root/
├── server.js                  # HTTP bootstrap
├── src/
│   ├── app.js                 # Express app factory
│   ├── config/                # Env + model id helpers
│   ├── routes/                # /healthz, /v1/models, /v1/chat*, /v1/usage
│   ├── handlers/chat/         # stream + nonstream implementations
│   ├── middleware/            # rate-limit, access-log
│   └── utils.js               # helpers: CORS, tokens, model normalization
├── auth/server.mjs            # Traefik ForwardAuth service
├── docker-compose.yml         # Prod routing/labels
├── Dockerfile                 # Runtime image
├── tests/                     # Vitest + Playwright
└── docs/                      # Project docs (this file, playbooks)
```

## Source Tree and Module Organization

### Key Modules and Their Purpose

- `server.js`: Loads config, creates app (`src/app.js`), starts server and handles SIGTERM/SIGINT.
- `src/app.js`: Wires global CORS, access logs, rate limiter, and mounts routers: health, models, chat, usage. Exposes a test‑only `/__test/conc` when `PROXY_TEST_ENDPOINTS=true`.
- `src/routes/models.js`: Implements `/v1/models` GET/HEAD with optional gating via `PROXY_PROTECT_MODELS`. Uses `publicModelIds()` from `src/config/models.js` to advertise `codex-5` or `codev-5` variants by environment.
- `src/routes/chat.js`: Defines `/v1/chat/completions` and legacy `/v1/completions`, dispatching to stream/non‑stream handlers based on `body.stream`.
- `src/handlers/chat/nonstream.js`: Validates inputs, spawns Codex (“proto”) with arguments assembled in `shared.js`, aggregates child JSON events, and returns OpenAI‑shaped JSON with `usage`.
- `src/handlers/chat/stream.js`: Streams SSE frames with role‑first delta, maintains stable `id` and `created`, emits finish‑reason then usage then `[DONE]`, and manages keepalives and idle timeouts.
- `src/middleware/rate-limit.js`: Simple token bucket keyed by bearer (or IP) with `windowMs` and `max`. Not distributed; intended as defense‑in‑depth.
- `src/utils.js`: CORS utilities, token estimators, model normalization, and helpers.
- `auth/server.mjs`: Minimal ForwardAuth endpoint (`/verify`) validating bearer token against `PROXY_API_KEY` for Traefik; also exposes `/healthz`.

### Environment and Configuration

All configuration comes from `src/config/index.js` (see file for complete list). Important flags:

- `PORT` (default 11435)
- `PROXY_API_KEY` (bearer expected by the proxy and ForwardAuth)
- `PROXY_PROTECT_MODELS` (gate `/v1/models` behind bearer)
- `PROXY_ENABLE_CORS` (global CORS on/off)
- `PROXY_TIMEOUT_MS`, `PROXY_IDLE_TIMEOUT_MS`, `PROXY_STREAM_IDLE_TIMEOUT_MS`
- `PROXY_SSE_KEEPALIVE_MS`, `PROXY_SSE_MAX_CONCURRENCY`
- `PROXY_RATE_LIMIT_ENABLED`, `PROXY_RATE_LIMIT_WINDOW_MS`, `PROXY_RATE_LIMIT_MAX`
- `CODEX_BIN`, `CODEX_MODEL`, `CODEX_HOME`, `PROXY_CODEX_WORKDIR`, `CODEX_FORCE_PROVIDER`
- `PROXY_ENV` (controls advertised model IDs: `codev-5*` in dev, `codex-5*` in prod)

## APIs

### Health

- `GET /healthz` → `{ ok: true, sandbox_mode }` (no auth)

### Models

- `GET /v1/models` → `{ object: "list", data: [...] }` with model ids determined by environment
- `HEAD /v1/models` → `200` with JSON content-type
- `OPTIONS /v1/models` → `204` (CORS preflight)
- When `PROXY_PROTECT_MODELS=true`, GET/HEAD require bearer `PROXY_API_KEY` and return `401` otherwise

### Chat Completions

- `POST /v1/chat/completions` (non‑stream) → OpenAI‑shaped JSON with `usage`
- `POST /v1/chat/completions` (stream) → SSE frames with stable `id`/`created`, role‑first delta, finish‑reason, optional usage, `[DONE]`
- Legacy path `POST /v1/completions` supported with same behavior

Request body handling aligns with OpenAI fields (`model`, `messages` or `prompt`, `stream`, optional `include_usage`, etc.). Validation errors use `src/lib/errors.js` shapes.

## Development and Deployment

### Local Development

- Node.js `>=22` required (see `package.json` engines)
- Install and run: `npm install && npm run start`
- Dev stack (Traefik + proxy + ForwardAuth): `npm run dev:stack:up` (see `compose.dev.stack.yml`)
- Quick checks:
  - Health: `curl -s 127.0.0.1:11435/healthz`
  - Models: `curl -s 127.0.0.1:11435/v1/models`
  - Chat: `curl -s 127.0.0.1:11435/v1/chat/completions -H "Authorization: Bearer $PROXY_API_KEY" -H 'Content-Type: application/json' -d '{"model":"codex-5","stream":false,"messages":[{"role":"user","content":"Say hello."}]}'`

### Testing

- Unit/integration (Vitest): `npm run test:unit`, `npm run test:integration`
- E2E (Playwright): `npm test` (includes SSE and CORS contract tests)
- All checks: `npm run verify:all` (format, lint, tests)

### Container & Prod Notes

- Build and run: `docker compose up -d --build`
- Traefik ForwardAuth must point to `http://127.0.0.1:18080/verify` when Traefik runs host‑side (see `auth/server.mjs`). Do not switch to container DNS unless Traefik is also containerized on the same network.
- Keep labels `codex-api`, `codex-preflight`, `codex-models`, `codex-health` intact; attach to external `traefik` network.
- Ensure `.codex-api/` (CODEX_HOME) is writable in production for rollout/session files to support streaming stability.

## Technical Debt and Known Issues

- Rate limiting is in‑process and non‑distributed; rely on edge (Traefik/Cloudflare) for real enforcement.
- Concurrency limit for SSE streams is global (`PROXY_SSE_MAX_CONCURRENCY`); exceeding returns `429` with `concurrency_exceeded`.
- CORS implementation is permissive by default; set `PROXY_ENABLE_CORS=false` if running strictly behind trusted origins.
- Some dev logs are printed unstructured to stdout alongside JSON access logs (see `src/app.js`).
- No persistence by design; if future features require state, introduce a data layer explicitly.

## Integration Points and External Dependencies

- Codex CLI child process (configured via `CODEX_BIN`, `CODEX_HOME`, `PROXY_CODEX_WORKDIR`) — spawned by chat handlers.
- Traefik reverse proxy (Docker labels in `docker-compose.yml`).
- Optional Cloudflare in front of Traefik; production smoke (`npm run smoke:prod`) recommended after deploys that affect routing/labels.

## Appendix — Useful Commands

```bash
npm run start              # Start server
npm run verify:all         # Lint, format, unit, integration, e2e
docker compose up -d --build  # Build + run container
```

## Gotchas and Constraints

- When `PROXY_PROTECT_MODELS=true`, clients must send `Authorization: Bearer $PROXY_API_KEY` even for `/v1/models`.
- Streaming path emits keepalives at `PROXY_SSE_KEEPALIVE_MS`; set `X-No-Keepalive: 1` to suppress in some clients.
- `PROXY_KILL_ON_DISCONNECT=true` will terminate the child on client disconnect; otherwise the child may complete in background.

